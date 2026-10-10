//! Logs the Clock sysvar as seen by a program; used to verify clock overrides.
//! Build: cargo build-sbf --sbf-out-dir .. (produces ../clock_probe.so)

use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint, entrypoint::ProgramResult, msg,
    pubkey::Pubkey, sysvar::Sysvar,
};

entrypoint!(process_instruction);

fn process_instruction(_program_id: &Pubkey, _accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let clock = Clock::get()?;
    msg!("clock slot={} unix_timestamp={}", clock.slot, clock.unix_timestamp);
    Ok(())
}
