GRANT SELECT, INSERT, UPDATE ON score_rules TO salescrm;
GRANT SELECT, INSERT, UPDATE ON score_feedback TO salescrm;

REVOKE DELETE ON score_rules, score_feedback FROM salescrm;
REVOKE ALL ON score_rules, score_feedback FROM salescrm_auth;
