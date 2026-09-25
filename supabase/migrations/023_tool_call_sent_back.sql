-- 'sent_back': a guardrail returned the call to the agent to fix - a draft
-- that broke a writing rule, a search keyword made of criteria words, a
-- finalize with work still left. That's the system working as intended,
-- so it's recorded apart from 'error', which is kept for real failures
-- (a provider down, a database error, bad configuration).
alter table tool_calls drop constraint tool_calls_status_check;
alter table tool_calls add constraint tool_calls_status_check check (status in ('ok', 'error', 'denied', 'cache_hit', 'sent_back'));
