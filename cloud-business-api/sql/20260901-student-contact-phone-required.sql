BEGIN;

ALTER TABLE business.student_contact_directory
  ADD CONSTRAINT student_contact_directory_phone_required
  CHECK (phone_value IS NOT NULL) NOT VALID;

COMMIT;
