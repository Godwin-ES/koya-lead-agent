-- Task 18: the evidence drawer needs to show a lead's actual scraped
-- page content inside a labelled untrusted-source block
-- (SYSTEM-DESIGN-NEXTJS.md §17.9: "Scraped content is displayed as data
-- inside a visually distinct, clearly labelled untrusted-source block,
-- so nobody mistakes a page's text for the app's own instructions").
--
-- Task 4's own comment on `scrape_cache` called it "internal
-- implementation detail... No authenticated or anon access at all" -
-- correct at the time (nothing yet needed to read it), but it made this
-- requirement architecturally impossible: the web app only ever holds
-- the anon key, and `scrape_cache` had zero policies for that role
-- (RLS's default-deny with no matching policy). `source_summary` on
-- `leads` is a model-*generated* summary, not the raw page - it cannot
-- stand in for this.
--
-- Scoped narrowly: a row is visible only if its `url` matches one of
-- the `source_urls` on a lead the requesting user actually owns (via
-- `leads.run_id -> runs.user_id`) - not blanket read access to a table
-- that's shared, unscoped cache data across every run and every user.
grant select on scrape_cache to authenticated, anon;

create policy scrape_cache_select_for_owned_leads on scrape_cache for select
  to authenticated, anon
  using (
    exists (
      select 1
      from leads
      join runs on runs.id = leads.run_id
      where scrape_cache.url = any(leads.source_urls)
        and runs.user_id = auth.uid()
    )
  );
