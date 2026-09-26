CREATE FUNCTION prevent_terminal_playbook_sample_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status sales_playbook_status;
  parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.playbook_id ELSE NEW.playbook_id END;
  SELECT status INTO parent_status FROM sales_playbooks WHERE id = parent_id FOR SHARE;
  IF parent_status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'published or retired playbook samples are immutable' USING ERRCODE = '40001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER sales_playbook_samples_terminal_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sales_playbook_samples
  FOR EACH ROW EXECUTE FUNCTION prevent_terminal_playbook_sample_mutation();
