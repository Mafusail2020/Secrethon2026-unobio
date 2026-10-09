"""What the gateway refuses, measured, in one place. Prompts and replies are sized against these."""

# a prompt past about 14k characters is refused, system prompt included; this leaves a margin
GATEWAY_PROMPT_CHARS = 13_000
# a reply cap above about 4k tokens is refused; a reasoning model spends some of it thinking
GATEWAY_MAX_OUTPUT_TOKENS = 4_000
