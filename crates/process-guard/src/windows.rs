//! The only native-API boundary. OWNER RIGHTS is essential: without it a
//! same-user owner can restore `WRITE_DAC` despite ordinary deny ACEs. This does
//! not revoke handles already opened, protect thread objects, or sandbox files.
#![allow(unsafe_code)]

use std::io;
use windows::Win32::{
    Foundation::{HLOCAL, LocalFree},
    Security::{
        Authorization::{
            ConvertStringSecurityDescriptorToSecurityDescriptorW, SE_KERNEL_OBJECT, SetSecurityInfo,
        },
        DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl, PROTECTED_DACL_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR,
    },
    System::Threading::GetCurrentProcess,
};
use windows::core::{BOOL, w};

struct Descriptor(PSECURITY_DESCRIPTOR);

impl Drop for Descriptor {
    fn drop(&mut self) {
        // SAFETY: the conversion API allocated this descriptor with LocalAlloc;
        // this value owns it, and SetSecurityInfo has copied its ACL already.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.0.0)));
        }
    }
}

pub(super) fn protect() -> io::Result<()> {
    // OWNER RIGHTS suppresses implicit owner WRITE_DAC. The owner can query,
    // synchronize and terminate; SYSTEM retains full access. Deliberately no
    // VM_READ/WRITE/OPERATION, DUP_HANDLE, CREATE_PROCESS/THREAD or WRITE_DAC.
    // 0x00121001 = SYNCHRONIZE | READ_CONTROL | QUERY_LIMITED_INFORMATION | TERMINATE.
    let mut raw = PSECURITY_DESCRIPTOR::default();
    // SAFETY: fixed valid SDDL; out pointer is writable and starts empty.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            w!("D:P(A;;0x00121001;;;OW)(A;;GA;;;SY)"),
            1,
            &raw mut raw,
            None,
        )
    }
    .map_err(io::Error::other)?;
    let descriptor = Descriptor(raw);
    let mut present = BOOL::default();
    let mut defaulted = BOOL::default();
    let mut acl = std::ptr::null_mut();
    // SAFETY: descriptor remains live while extracting/copying its ACL; the
    // pseudohandle names this process and is never closed. No other process is
    // modified, and children do not inherit a process security descriptor.
    unsafe {
        GetSecurityDescriptorDacl(
            descriptor.0,
            &raw mut present,
            &raw mut acl,
            &raw mut defaulted,
        )
        .map_err(io::Error::other)?;
        if !present.as_bool() || acl.is_null() {
            return Err(io::Error::other("missing process DACL"));
        }
        SetSecurityInfo(
            GetCurrentProcess(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(acl),
            None,
        )
        .ok()
        .map_err(io::Error::other)
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::{
        Foundation::{CloseHandle, WIN32_ERROR},
        System::Threading::{
            OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_DUP_HANDLE,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        },
    };

    fn can_open(pid: u32, access: PROCESS_ACCESS_RIGHTS) -> bool {
        // SAFETY: only opens a process id owned by this test; a successful
        // handle is closed exactly once. No memory is read.
        unsafe {
            match OpenProcess(access, false, pid) {
                Ok(handle) => {
                    let _ = CloseHandle(handle);
                    true
                }
                Err(error) => {
                    assert_eq!(error.code(), WIN32_ERROR(5).to_hresult());
                    false
                }
            }
        }
    }

    /// Rights that expose memory, handles or execution of a process.
    const DANGEROUS: [PROCESS_ACCESS_RIGHTS; 8] = [
        PROCESS_VM_READ,
        PROCESS_DUP_HANDLE,
        PROCESS_ACCESS_RIGHTS(0x0004_0000), // WRITE_DAC
        PROCESS_ACCESS_RIGHTS(0x0008_0000), // WRITE_OWNER
        PROCESS_ACCESS_RIGHTS(0x0008),      // VM_OPERATION
        PROCESS_ACCESS_RIGHTS(0x0020),      // VM_WRITE
        PROCESS_ACCESS_RIGHTS(0x0080),      // CREATE_PROCESS
        PROCESS_ACCESS_RIGHTS(0x0002),      // CREATE_THREAD
    ];

    #[test]
    fn protection_fixture() {
        if std::env::var("PRAXI_GUARD_FIXTURE").as_deref() != Ok("yes") {
            return;
        }
        let pid = std::process::id();
        for access in DANGEROUS {
            assert!(can_open(pid, access), "before: {access:?}");
        }
        let report = crate::protect();
        assert_eq!(report.outcome, crate::Outcome::Applied, "{report:?}");
        for access in DANGEROUS {
            assert!(!can_open(pid, access), "after: {access:?}");
        }
        assert!(can_open(pid, PROCESS_QUERY_LIMITED_INFORMATION));

        // Children must be unaffected: they start, run, and stay inspectable.
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 3 127.0.0.1 >nul"])
            .spawn()
            .unwrap();
        for access in DANGEROUS {
            assert!(can_open(child.id(), access), "child must keep {access:?}");
        }
        assert!(child.wait().unwrap().success());
    }
}
