SELECT *
FROM (
    VALUES
    (1, 'Wireless Mouse', 'Electronics', 'LogiTech', 29.99),
    (2, 'Mechanical Keyboard', 'Electronics', 'KeyMaster', 89.99),
    (3, 'USB-C Dock', 'Electronics', 'DockHub', 119.99),
    (4, '27 Inch Monitor', 'Electronics', 'VisionTech', 249.99),
    (5, 'Laptop Stand', 'Accessories', 'ErgoDesk', 39.99),
    (6, 'Noise Cancelling Headphones', 'Audio', 'SoundPro', 199.99),
    (7, 'Webcam HD', 'Electronics', 'StreamCam', 69.99),
    (8, 'Office Chair', 'Furniture', 'ComfortSeat', 299.99),
    (9, 'Standing Desk', 'Furniture', 'ErgoDesk', 499.99),
    (10, 'Bluetooth Speaker', 'Audio', 'SoundPro', 79.99)
) AS products (
    product_id,
    product_name,
    category,
    brand,
    unit_price
)
