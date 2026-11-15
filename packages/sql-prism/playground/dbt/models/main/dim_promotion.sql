SELECT
    promotion_id,
    promotion_name,
    promotion_type,
    discount_percent

FROM (
    VALUES
    (1, 'Black Friday', 'Percentage', 30),
    (2, 'Christmas Sale', 'Percentage', 20),
    (3, 'New Year Sale', 'Percentage', 15),
    (4, 'Summer Clearance', 'Percentage', 40),
    (5, 'Back To School', 'Percentage', 10),
    (6, 'Free Shipping Weekend', 'Shipping', 100),
    (7, 'Loyalty Discount', 'Percentage', 5),
    (8, 'BOGO', 'BOGO', 50),
    (9, 'Spring Sale', 'Percentage', 25),
    (10, 'VIP Exclusive', 'Percentage', 35)
) AS promotions (promotion_id, promotion_name, promotion_type, discount_percent)
