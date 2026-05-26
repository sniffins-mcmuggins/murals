CREATE TABLE collection_images (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id   uuid        NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    s3_key          text        NOT NULL,
    cdn_url         text        NOT NULL,
    display_order   int         NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_images_collection_order_idx ON collection_images (collection_id, display_order);
