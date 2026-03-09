pub(crate) fn is_wasapi_unsupported_format_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("0x88890008") || lower.contains("audclnt_e_unsupported_format")
}

#[cfg(target_os = "windows")]
pub(crate) fn wasapi_exclusive_fallback_candidates(
    target_rate_hz: u32,
    target_bit_depth: u16,
) -> Vec<(u32, u16)> {
    let preferred_rates_hz = [target_rate_hz, 48_000, 44_100, 96_000];
    let preferred_bit_depths = [target_bit_depth, 24, 16, 32];
    let mut candidates: Vec<(u32, u16)> = Vec::new();

    for sample_rate_hz in preferred_rates_hz {
        for bit_depth in preferred_bit_depths {
            if sample_rate_hz == 0 || !matches!(bit_depth, 16 | 24 | 32) {
                continue;
            }
            if candidates.contains(&(sample_rate_hz, bit_depth)) {
                continue;
            }
            candidates.push((sample_rate_hz, bit_depth));
        }
    }

    if candidates.is_empty() {
        candidates.push((48_000, 16));
    }
    candidates
}
