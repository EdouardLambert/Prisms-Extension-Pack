SELECT
    customer_id,
    customer_name,
    customer_segment,
    country

FROM (
    VALUES
    (1, 'Alice Martin', 'Premium', 'France'),
    (2, 'Bob Durand', 'Standard', 'France'),
    (3, 'Claire Petit', 'Premium', 'Belgium'),
    (4, 'David Bernard', 'Standard', 'Switzerland'),
    (5, 'Emma Robert', 'VIP', 'France'),
    (6, 'Lucas Moreau', 'Standard', 'France'),
    (7, 'Sophie Leroy', 'Premium', 'Belgium'),
    (8, 'Thomas Dubois', 'VIP', 'Luxembourg'),
    (9, 'Julie Simon', 'Standard', 'France'),
    (10, 'Hugo Laurent', 'Premium', 'Canada')
) AS customers (customer_id, customer_name, customer_segment, country)
