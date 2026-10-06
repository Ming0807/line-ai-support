-- Runtime imports retain immutable originals/revisions/reviews/publication receipts.
-- Privileged operator fixture/restore operations remain separate from application grants.
revoke delete on private.knowledge_import_jobs from service_role;
