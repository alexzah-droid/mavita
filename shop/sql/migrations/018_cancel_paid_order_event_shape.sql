-- Разрешить событие 'cancelled' для оплаченных заказов (new/packing → cancelled).
-- До этой миграции shape_check допускал cancelled-событие только из awaiting_payment,
-- что исключало отмену уже оплаченных заказов через API.

ALTER TABLE order_admin_events DROP CONSTRAINT order_admin_events_shape_check;
ALTER TABLE order_admin_events
  ADD CONSTRAINT order_admin_events_shape_check CHECK (
    (event_type = 'cancelled'
       AND reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 5 AND 500
       AND from_fulfillment_status IN ('awaiting_payment', 'new', 'packing')
       AND to_fulfillment_status = 'cancelled' AND tracking_number IS NULL)
    OR (event_type = 'fulfillment_transition' AND reason IS NULL
       AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL
       AND ((from_fulfillment_status = 'new'              AND to_fulfillment_status = 'packing'           AND tracking_number IS NULL)
         OR (from_fulfillment_status = 'packing'          AND to_fulfillment_status = 'handed_to_carrier'
             AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64)
         OR (from_fulfillment_status = 'handed_to_carrier' AND to_fulfillment_status = 'delivered'        AND tracking_number IS NULL)))
    OR (event_type = 'cdek_status_update' AND reason IS NULL
       AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL)
  );
