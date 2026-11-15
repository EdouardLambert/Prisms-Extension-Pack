WITH
customers AS (
    SELECT dim_customers.*
    FROM {{ ref('dim_customers') }} AS dim_customers
),

promotions AS (
    WITH products AS (
        SELECT dim_products.*
        FROM {{ ref('dim_products') }} AS dim_products
    )

    SELECT
        promotion.*,
        products.*
    FROM {{ ref('dim_promotion') }} AS promotion
    LEFT JOIN products
        ON promotion.product_id = products.product_id
)

SELECT
    orders.order_id::INTEGER,
    orders.order_date::BOOLEAN,
    orders.amount::DOUBLE,
    customers.customer_name::VARCHAR,
    customers.country::JSON,
    products.product_name::DATE,
    products.category,
    promotions.promotion_name,
    promotions.discount_percent

FROM {{ ref('fct_orders') }} AS orders

LEFT JOIN customers
    ON orders.customer_id = customers.customer_id

LEFT JOIN products
    ON orders.product_id = products.product_id

LEFT JOIN promotions
    ON orders.promotion_id = promotions.promotion_id
