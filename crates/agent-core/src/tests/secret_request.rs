//! `secret_request`: the loop parks the run on the owner's form and the model
//! learns only `stored` or `cancelled`. The value itself is written by the
//! daemon's submit route (tested in daemon-api); here the test plays that route.

use secret_store::{FillSecrets, MemoryStore};
use std::fmt::Write as _;

use super::*;

const CANARY: &str = "canary-Correct-Horse-Battery-4417!";

fn loop_with_request_tool(env: &Env, fake: &Arc<Fake>, config: LoopConfig) -> AgentLoop {
    let lp = make_loop(&env.storage, env.bot, fake, &[], profile(""), config);
    let secrets = Arc::new(FillSecrets::in_memory(Arc::new(MemoryStore::new())));
    lp.sh
        .tools
        .register(builtin_tools::secret_request::secret_request_tool(secrets));
    lp
}

fn ask() -> Value {
    json!({"name":"login/example","purpose":"Sign in to download the invoice","fields":"login"})
}

fn requested(e: &Event) -> bool {
    matches!(e, Event::SecretRequested(_))
}

#[tokio::test]
async fn the_owner_answers_and_the_model_sees_only_stored() {
    let env = setup();
    let fake = Fake::new(vec![
        calls(&[("c1", "secret_request", ask())]),
        text("thanks"),
    ]);
    let lp = loop_with_request_tool(&env, &fake, cfg(Policy::full()));
    let mut rx = lp.subscribe();
    let run = lp.run_turn(env.chat, "log in for me").unwrap();
    let Event::SecretRequested(card) = until(&mut rx, requested).await else {
        unreachable!()
    };
    assert_eq!(card.name, "login/example");
    assert_eq!(card.expires_in_secs, 300);
    assert!(!card.untrusted_content);
    assert_eq!(lp.runtime().state(run).unwrap(), RunState::WaitingApproval);
    assert!(lp.secret_request(card.call_id).is_some());

    // The submit route's part: claim once, store, wake the run.
    assert!(lp.claim_secret_request(card.call_id).is_some());
    assert!(
        lp.claim_secret_request(card.call_id).is_none(),
        "single use"
    );
    lp.finish_secret_request(card.call_id, true, env.user)
        .unwrap();
    assert_eq!(lp.wait(run).await.unwrap(), RunState::Succeeded);

    let msgs = tool_messages(&fake.request(1));
    assert_eq!(msgs.len(), 1);
    assert!(msgs[0].starts_with("stored:"), "{}", msgs[0]);
    // Nothing the run wrote anywhere contains the value.
    let mut all = serde_json::to_string(&msgs).unwrap();
    while let Ok(i) = rx.try_recv() {
        all.push_str(&serde_json::to_string(&i.envelope.event).unwrap());
    }
    let _ = write!(all, "{:?}", env.storage.list_audit(env.user).unwrap());
    assert!(!all.contains(CANARY));
    let audit = format!("{:?}", env.storage.list_audit(env.user).unwrap());
    assert!(audit.contains("secret_request.requested") && audit.contains("secret_request.stored"));
}

#[tokio::test]
async fn cancel_and_a_forged_question_answer_both_end_as_cancelled() {
    for forge in [false, true] {
        let env = setup();
        let fake = Fake::new(vec![calls(&[("c1", "secret_request", ask())]), text("ok")]);
        let lp = loop_with_request_tool(&env, &fake, cfg(Policy::full()));
        let mut rx = lp.subscribe();
        let run = lp.run_turn(env.chat, "go").unwrap();
        let Event::SecretRequested(card) = until(&mut rx, requested).await else {
            unreachable!()
        };
        if forge {
            // `POST /v1/questions/{id}` must not be able to claim "stored".
            lp.answer_question(card.call_id, "stored").unwrap();
        } else {
            lp.finish_secret_request(card.call_id, false, env.user)
                .unwrap();
        }
        assert_eq!(lp.wait(run).await.unwrap(), RunState::Succeeded);
        let msgs = tool_messages(&fake.request(1));
        assert!(msgs[0].starts_with("cancelled:"), "{forge}: {}", msgs[0]);
        assert!(lp.secret_request(card.call_id).is_none());
    }
}

#[tokio::test]
async fn a_request_nobody_answers_expires_and_leaves_nothing() {
    let env = setup();
    let fake = Fake::new(vec![calls(&[("c1", "secret_request", ask())]), text("ok")]);
    let mut config = cfg(Policy::full());
    config.secret_request_timeout = Duration::from_millis(50);
    let lp = loop_with_request_tool(&env, &fake, config);
    let mut rx = lp.subscribe();
    let run = lp.run_turn(env.chat, "go").unwrap();
    let Event::SecretRequested(card) = until(&mut rx, requested).await else {
        unreachable!()
    };
    assert_eq!(lp.wait(run).await.unwrap(), RunState::Succeeded);
    let msgs = tool_messages(&fake.request(1));
    assert!(msgs[0].contains("did not answer in time"), "{}", msgs[0]);
    assert!(lp.secret_request(card.call_id).is_none());
    assert!(
        lp.finish_secret_request(card.call_id, true, env.user)
            .is_err()
    );
}

#[tokio::test]
async fn a_channel_run_is_refused_and_no_form_is_shown() {
    let env = setup();
    let fake = Fake::new(vec![calls(&[("c1", "secret_request", ask())]), text("ok")]);
    let lp = loop_with_request_tool(&env, &fake, cfg(Policy::full()));
    let mut rx = lp.subscribe();
    let run = lp
        .run_turn_as(env.chat, "log in", protocol::InitiatorKind::Channel)
        .unwrap();
    assert_eq!(lp.wait(run).await.unwrap(), RunState::Succeeded);
    let msgs = tool_messages(&fake.request(1));
    assert!(msgs[0].starts_with("cancelled:"), "{}", msgs[0]);
    assert!(msgs[0].contains("started at the desktop"), "{}", msgs[0]);
    while let Ok(i) = rx.try_recv() {
        assert!(!requested(&i.envelope.event), "a form was shown");
    }
}

#[tokio::test]
async fn the_global_switch_and_the_per_run_limit_refuse() {
    let env = setup();
    let fake = Fake::new(vec![calls(&[("c1", "secret_request", ask())]), text("ok")]);
    let mut config = cfg(Policy::full());
    config.secret_requests = false;
    let lp = loop_with_request_tool(&env, &fake, config);
    let run = lp.run_turn(env.chat, "go").unwrap();
    assert_eq!(lp.wait(run).await.unwrap(), RunState::Succeeded);
    assert!(tool_messages(&fake.request(1))[0].contains("switched off"));

    let env = setup();
    let fake = Fake::new(vec![calls(&[("c1", "secret_request", ask())]), text("ok")]);
    let mut config = cfg(Policy::full());
    config.max_secret_requests_per_run = 0;
    let lp = loop_with_request_tool(&env, &fake, config);
    let run = lp.run_turn(env.chat, "go").unwrap();
    assert_eq!(lp.wait(run).await.unwrap(), RunState::Succeeded);
    assert!(tool_messages(&fake.request(1))[0].contains("too often"));
}
