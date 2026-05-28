ALTER TABLE collections
  ADD COLUMN cover_focal_x float4 NOT NULL DEFAULT 50,
  ADD COLUMN cover_focal_y float4 NOT NULL DEFAULT 50;
