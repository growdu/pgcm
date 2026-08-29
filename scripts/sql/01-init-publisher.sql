-- Bootstrap a demo logical replication publisher so pgcm has something to show.
CREATE PUBLICATION demo_pub FOR ALL TABLES;
SELECT 'publisher ready' AS status;
