//! Corpus tests for `detect_secrets` (issue #421, slice 2).
//!
//! Positive values are FAKE and are assembled at run time from a prefix and a
//! body, so no secret-shaped literal sits in the source (it would trip secret
//! scanners and push protection). Hard targets: every positive is detected
//! with the expected kind and exact span, and nothing in the negative corpus
//! is reported.

use secret_store::{Confidence, SecretKind, detect_secrets};

fn join(prefix: &str, body: &str) -> String {
    format!("{prefix}{body}")
}

/// (kind, value) known provider shapes, high confidence.
fn known_shapes() -> Vec<(SecretKind, String)> {
    vec![
        (
            SecretKind::OpenAiStyleKey,
            join("sk-", "proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34"),
        ),
        (
            SecretKind::OpenAiStyleKey,
            join("sk-", "ant-api03-Zx98Yw76Vu54Ts32Rq10Po98"),
        ),
        (
            SecretKind::OpenAiStyleKey,
            join("sk-", "or-v1-0a1b2c3d4e5f60718293a4b5c6d7e8f9"),
        ),
        (
            SecretKind::GoogleApiKey,
            join("AI", "zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"),
        ),
        (
            SecretKind::GithubToken,
            join("gh", "p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
        ),
        (
            SecretKind::GithubToken,
            join(
                "github",
                "_pat_11AAAAAAA0abcdefGHIJKL_mnopqrstuvwxyz0123456789",
            ),
        ),
        (
            SecretKind::SlackToken,
            join("xo", "xb-123456789012-abcdefghijklmnop"),
        ),
        (
            SecretKind::NvidiaKey,
            join("nv", "api-A1b2C3d4E5f6G7h8I9j0K1l2"),
        ),
        (
            SecretKind::Jwt,
            join(
                "ey",
                "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
            ),
        ),
        (SecretKind::AwsAccessKeyId, join("AK", "IAABCD1234EFGH5678")),
        (
            SecretKind::StripeKey,
            join("sk_li", "ve_A1b2C3d4E5f6G7h8I9j0K1l2"),
        ),
        (
            SecretKind::TelegramBotToken,
            join("123456789:", "AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1"),
        ),
        (
            SecretKind::NpmToken,
            join("np", "m_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
        ),
        (
            SecretKind::GitlabToken,
            join("gl", "pat-A1b2C3d4E5f6G7h8I9j0"),
        ),
        (
            SecretKind::HuggingFaceToken,
            join("h", "f_abcdefghijklmnopqrstuvwxyzABCDEFGH"),
        ),
        (
            SecretKind::GroqKey,
            join("gs", "k_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"),
        ),
        (
            SecretKind::DigitalOceanToken,
            join(
                "dop",
                "_v1_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
        ),
    ]
}

#[test]
fn every_known_shape_is_detected_with_exact_span() {
    for (kind, value) in known_shapes() {
        for template in [
            "{}",
            "here is my key: {} thanks",
            "export FOO={}\n",
            "(\"{}\")",
            "anahtarım {} bu",
        ] {
            let text = template.replace("{}", &value);
            let found = detect_secrets(&text);
            assert_eq!(found.len(), 1, "kind {kind} in {template:?}: {found:?}");
            let c = found[0];
            assert_eq!(c.kind, kind, "template {template:?}");
            assert_eq!(c.confidence, Confidence::High);
            assert_eq!(c.slice(&text), Some(value.as_str()), "span for {kind}");
        }
    }
}

#[test]
fn private_key_block_is_detected_whole_and_when_truncated() {
    let begin = join("-----BEGIN ", "OPENSSH PRIVATE KEY-----");
    let end = join("-----END ", "OPENSSH PRIVATE KEY-----");
    let full = format!("see {begin}\nb3BlbnNzaC1rZXktdjEAAAAA\n{end} ok");
    let found = detect_secrets(&full);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].kind, SecretKind::PrivateKey);
    assert!(found[0].slice(&full).unwrap().ends_with(&end));
    let cut = format!("{begin}\nb3BlbnNzaC1rZXktdjEAAAAA");
    let found = detect_secrets(&cut);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].end, cut.len());
}

/// (kind, text, value) labelled context in English and Turkish.
fn labelled() -> Vec<(SecretKind, String, &'static str)> {
    let api = "Zk3fQ9xLm2Pv7RtYb4Wn8HsJc6Ud1Ae0";
    let hex = "9f86d081884c7d659a2feaa0c55ad015";
    let pw = "Tr0ub4dor&3";
    let cases: Vec<(SecretKind, &str, &'static str)> = vec![
        (SecretKind::LabelledApiKey, "my api key is {}", api),
        (SecretKind::LabelledApiKey, "API_KEY={}", api),
        (SecretKind::LabelledApiKey, "OPENAI_API_KEY=\"{}\"", api),
        (SecretKind::LabelledApiKey, "api-key: {}", api),
        (SecretKind::LabelledApiKey, "apikey = {}", api),
        (SecretKind::LabelledApiKey, "api anahtarım: {}", api),
        (SecretKind::LabelledSecret, "gizli anahtar şu: {}", api),
        (SecretKind::LabelledApiKey, "Anahtar: {}", api),
        (SecretKind::LabelledApiKey, "erişim anahtarı {}", api),
        (SecretKind::LabelledToken, "token: {}", api),
        (SecretKind::LabelledToken, "GITHUB_TOKEN={}", api),
        (SecretKind::LabelledToken, "Authorization: Bearer {}", api),
        (SecretKind::LabelledToken, "bot token is {}", hex),
        (SecretKind::LabelledToken, "jeton: {}", api),
        (SecretKind::LabelledSecret, "client secret = {}", api),
        (SecretKind::LabelledSecret, "{\"secret\": \"{}\"}", api),
        (SecretKind::LabelledPassword, "password: {}", pw),
        (SecretKind::LabelledPassword, "my password is {}", pw),
        (SecretKind::LabelledPassword, "DB_PASSWORD={}", pw),
        (SecretKind::LabelledPassword, "Şifre: {}", pw),
        (SecretKind::LabelledPassword, "ŞİFRE: {}", pw),
        (SecretKind::LabelledPassword, "sifre {}", pw),
        (SecretKind::LabelledPassword, "şifrem {}", pw),
        (SecretKind::LabelledPassword, "parola: {}", pw),
        (SecretKind::LabelledPassword, "parolam şu: {}", pw),
        (SecretKind::LabelledPassword, "passphrase = {}", pw),
    ];
    cases
        .into_iter()
        .map(|(k, t, v)| (k, t.replacen("{}", v, 1), v))
        .collect()
}

#[test]
fn labelled_values_are_detected_as_medium_with_exact_span() {
    for (kind, text, value) in labelled() {
        let found = detect_secrets(&text);
        assert_eq!(found.len(), 1, "{text:?}: {found:?}");
        let c = found[0];
        assert_eq!(c.kind, kind, "{text:?}");
        assert_eq!(c.confidence, Confidence::Medium, "{text:?}");
        assert_eq!(c.slice(&text), Some(value), "{text:?}");
    }
}

#[test]
fn several_secrets_in_one_message_are_all_found_in_order() {
    let a = join("gh", "p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
    let text = format!("repo token {a} and sifre: Tr0ub4dor&3 done");
    let found = detect_secrets(&text);
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!(found[0].kind, SecretKind::GithubToken);
    assert_eq!(found[1].kind, SecretKind::LabelledPassword);
    assert!(found[0].end <= found[1].start);
}

/// Everything here must produce ZERO candidates.
fn negatives() -> Vec<&'static str> {
    vec![
        // Laughs and keyboard mashes (en/tr).
        "ahahahah",
        "ahahahahahahahahah",
        "hahahahaha",
        "asdfghjkl",
        "qwertyuiop",
        "Ajzashkjdgasda",
        "sjdhfjksdh",
        "AJzkdhfksjdhfkjsdhfk",
        "lolololol",
        "kkkkkkkkkkkk",
        "slkdjfhslkdjfhsldkjfh",
        "token: asdfghjklqwertyuiop",
        "password: asdfghjkl",
        // Plain words and names.
        "Merhaba nasılsın bugün hava çok güzel",
        "Constantinople internationalization Muhammadovich",
        "Anahtar teslim proje için teklif hazırla",
        "Çok gizli bir toplantı var yarın",
        // IDs and hashes.
        "123e4567-e89b-12d3-a456-426614174000",
        "9f86d081884c7d659a2feaa0c55ad01525a4f4be",
        "commit 3f786850e387550fdab836ed7e6dc881de23001b fixes it",
        "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        // Paths and URLs.
        "C:\\Users\\emre\\Documents\\notlar\\sifre-listesi-2024.txt",
        "/home/emre/projects/praxi/crates/secret-store/src/lib.rs",
        "https://github.com/emreocell/Praxi-Bot/issues/421",
        "https://example.com/api/v1/users/12345/tokens?page=2&limit=50",
        "see https://docs.example.com/guide/authentication-and-api-keys-overview#tokens",
        "token: https://example.com/path/to/resource/abc123def456",
        "api key: /usr/local/share/applications/praxi123456789",
        // Versions.
        "v1.2.3",
        "praxi-bot 0.14.2-beta.4",
        "api key: 10.20.30.40.50.60.70.80",
        "node 22.11.0 and rustc 1.91.0-nightly",
        // Base64 image data (no label).
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg",
        // Code snippets.
        "let token = tokenizer.next_token().unwrap();",
        "const apiKey = process.env.OPENAI_API_KEY;",
        "if (password.length < 8) { return false; }",
        "fn check_password(password: &str) -> bool {",
        "password = getpass.getpass('Password: ')",
        "headers = {'Authorization': f'Bearer {token}'}",
        "curl -H \"Authorization: Bearer $TOKEN\" https://api.example.com",
        "export OPENAI_API_KEY=$OPENAI_API_KEY",
        "const sk = skills.filter(s => s.enabled);",
        "git clone https://github.com/ask-ai/task-runner.git",
        "pip install sk-learn-is-a-fine-library-for-ml",
        "disk-encryption-key-management-service-v2",
        "task-abcdefghijklmnopqrstuvwxyz0123456",
        // Labels with prose or placeholders, no secret value.
        "password is required",
        "what is a good password manager?",
        "I forgot my password again",
        "şifremi unuttum, ne yapmalıyım?",
        "şifre: ********",
        "password: <your-password>",
        "password: ${DB_PASSWORD}",
        "token: [REDACTED]",
        "api key: your_api_key_here",
        "api key: xxxxxxxxxxxxxxxxxxxxxxxx",
        "secret: [secret: login/openai]",
        "token limit is 4096 per request",
        "the token budget was exceeded at 12345 tokens",
        "password: 12345678",
        "parola: kedi",
        "password: hunter2",
        "client secret rotation policy: quarterly review of everything",
        "api key: my-long-token-name-for-the-prod-environment-2024",
        "token: internationalization2024",
        // Realistic chat messages.
        "Hey, can you summarise the PDF in my Downloads folder and email it to Ali?",
        "Yarın saat 14:30'da toplantı var, hatırlat lütfen. Not: Zoom linki mailde.",
        "The deployment failed at step 3/7 with exit code 137, any idea why?",
        "Siparişim 2024-11-18 tarihinde verildi, takip no: TR1234567890 ile sorgulayabilirsin.",
        "Please rotate the API key every 90 days and never share a password in chat.",
        "API anahtarını nereden bulabilirim? Ayarlar sayfasında göremedim.",
        "My phone is +90 532 123 45 67 and IBAN TR33 0006 1005 1978 6457 8413 26",
        "Meeting ID: 123 4567 8901, passcode is on the invite",
        "ahahahah çok güzeldi dün akşam, sjdhfjksdh yine mi uyudum",
        "def hash_password(pw): return bcrypt.hashpw(pw, bcrypt.gensalt())",
        "Teşekkürler! Şifre yenileme e-postası geldi, linke tıkladım.",
        "How do I store a token safely? Should I use the vault or an env file?",
        "AKIA is the prefix AWS uses for access key ids",
        "the ghp_ prefix and sk- prefix are known token shapes",
        "BEGIN PRIVATE KEY blocks should never be pasted",
    ]
}

#[test]
fn negative_corpus_has_zero_false_positives() {
    let mut failures = Vec::new();
    for text in negatives() {
        let found = detect_secrets(text);
        if !found.is_empty() {
            failures.push(format!("{text:?} -> {found:?}"));
        }
    }
    assert!(
        failures.is_empty(),
        "false positives:\n{}",
        failures.join("\n")
    );
}

#[test]
fn negatives_stay_clean_inside_longer_messages_and_unicode() {
    for text in negatives() {
        let wrapped = format!("Şu mesajı gönder 🙂 «{text}» çok teşekkürler\nsonra devam");
        assert_eq!(detect_secrets(&wrapped).len(), 0, "{wrapped:?}");
    }
}

#[test]
fn empty_and_huge_inputs_are_fine() {
    assert_eq!(detect_secrets("").len(), 0);
    let big = "ahahahah token: ".repeat(50_000);
    assert_eq!(detect_secrets(&big).len(), 0);
}
