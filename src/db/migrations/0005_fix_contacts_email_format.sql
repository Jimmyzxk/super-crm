ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_format;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_email_format
  CHECK (email IS NULL OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
