-- Migration: 0104_seed_community_configuration.sql
-- Purpose: configuration rows the Community Forum cannot work without — the twelve discussion
--          categories and the badge catalogue.
--
-- This is *configuration*, not activity. There is no seeded member, discussion, reply, reaction,
-- report or statistic anywhere in this migration: an empty forum that says it is empty is honest,
-- and fake conversations would make the reputation system, the member directory and the AI
-- knowledge bridge (which only ever publishes moderator-approved accepted solutions) actively
-- misleading.
--
-- Both inserts are idempotent on fixed UUIDs, so re-running this migration is a no-op and an
-- administrator's later edits (a renamed category, a reordered list, a disabled forum) are never
-- overwritten by a redeploy.

INSERT INTO community_categories (id, slug, name, description, purpose, accepts_solutions, staff_only_posting, is_enabled, position)
VALUES
  ('c1000000-0000-4000-8000-000000000001', 'general-discussion', 'General Discussion',
   'Open conversation about hosting, running a website, and everything in between. No question is too basic here.',
   'discussion', false, false, true, 1),
  ('c1000000-0000-4000-8000-000000000002', 'hosting-support', 'Hosting Support',
   'Help with shared hosting, cPanel, mail, SSL, migrations and day-to-day server problems. Community members and CloudHost247 staff answer together.',
   'question', true, false, true, 2),
  ('c1000000-0000-4000-8000-000000000003', 'domains-and-dns', 'Domains & DNS',
   'Registrations, transfers, nameservers, DNS records, propagation and certificates — discuss the layer that makes everything else reachable.',
   'question', true, false, true, 3),
  ('c1000000-0000-4000-8000-000000000004', 'vps-and-dedicated', 'VPS & Dedicated Servers',
   'Server administration, images, provisioning, networking, monitoring and hardening for virtual and dedicated machines.',
   'question', true, false, true, 4),
  ('c1000000-0000-4000-8000-000000000005', 'wordpress', 'WordPress',
   'Installation, themes, plugins, performance, security and troubleshooting for the platform most of our customers run on.',
   'question', true, false, true, 5),
  ('c1000000-0000-4000-8000-000000000006', 'web-development', 'Web Development',
   'PHP, HTML, CSS, JavaScript, APIs and frameworks. Ask about code that runs on CloudHost247, or share what you built.',
   'question', true, false, true, 6),
  ('c1000000-0000-4000-8000-000000000007', 'developer-corner', 'Developer Corner',
   'A dedicated space for developers: API discussions, integrations, Linux and hosting configuration, databases, security practice and open-source work.',
   'showcase', true, false, true, 7),
  ('c1000000-0000-4000-8000-000000000008', 'tutorials-and-guides', 'Tutorials & Guides',
   'Community-written technical tutorials — step-by-step guides with code, screenshots and the reasoning behind each step.',
   'showcase', false, false, true, 8),
  ('c1000000-0000-4000-8000-000000000009', 'announcements', 'CloudHost247 Announcements',
   'Official notices from the CloudHost247 team: product launches, maintenance windows, policy changes and platform updates.',
   'announcement', false, true, true, 9),
  ('c1000000-0000-4000-8000-000000000010', 'feature-requests', 'Feature Requests',
   'Suggest a service, tool or improvement. Clear problem statements with a use case get prioritised over one-line wishes.',
   'discussion', false, false, true, 10),
  ('c1000000-0000-4000-8000-000000000011', 'bug-reports', 'Bug Reports',
   'Report something broken on the website, the control panel or a CloudHost247 tool. Include steps to reproduce and what you expected.',
   'question', true, false, true, 11),
  ('c1000000-0000-4000-8000-000000000012', 'questions-and-answers', 'Questions & Answers',
   'Technical questions where one answer can be marked as the accepted solution, so the next person with the same problem finds it immediately.',
   'question', true, false, true, 12)
ON CONFLICT (id) DO NOTHING;

-- Badge catalogue. `automatic` badges are awarded by the service when the qualifying event is
-- recorded (and are never handed out by hand); `manual` badges are only ever granted by a
-- super_admin through the community administration API.
INSERT INTO community_badges (id, slug, name, description, kind, icon)
VALUES
  ('b1000000-0000-4000-8000-000000000001', 'accepted-solution', 'Accepted Solution',
   'Wrote an answer that the discussion author marked as the solution.', 'automatic', '✓'),
  ('b1000000-0000-4000-8000-000000000002', 'first-answer', 'First Answer',
   'Answered a question in the community for the first time.', 'automatic', '✎'),
  ('b1000000-0000-4000-8000-000000000003', 'helpful-contributor', 'Helpful Contributor',
   'Consistently helpful across several discussions, recognised by the CloudHost247 team.', 'manual', '★'),
  ('b1000000-0000-4000-8000-000000000004', 'verified-developer', 'Verified Developer',
   'A developer designation granted by the CloudHost247 team.', 'manual', '⌘'),
  ('b1000000-0000-4000-8000-000000000005', 'verified-staff', 'CloudHost247 Staff',
   'An official CloudHost247 team member. Only super administrators can grant this badge.', 'manual', '◆'),
  ('b1000000-0000-4000-8000-000000000006', 'tutorial-author', 'Tutorial Author',
   'Published a tutorial or guide in the community.', 'automatic', '▤')
ON CONFLICT (id) DO NOTHING;
