DROP TABLE IF EXISTS organiser_payments;
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
