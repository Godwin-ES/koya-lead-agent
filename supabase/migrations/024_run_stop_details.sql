-- Why a finished run stopped where it did, worked out from its own records
-- at finalize (tools/finish-check.ts computeStopDetails): which budget ran
-- out, and the counts behind it. The run page shows it as the reason, with
-- the matching way to continue - rather than partial_reason's text, whose
-- second half is the model's own summary and was wrong live.
alter table runs add column stop_details jsonb;
