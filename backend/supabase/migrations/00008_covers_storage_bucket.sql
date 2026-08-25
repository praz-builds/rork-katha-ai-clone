-- Create the `covers` storage bucket for AI-generated cover images.
-- Public read access (anyone can view covers via public URL).
-- Upload restricted to service role (backend only).
-- Max file size: 5MB (DALL-E 3 images are typically 1-3MB).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'covers',
  'covers',
  true,
  5242880,
  ARRAY['image/webp', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read cover images (public bucket).
CREATE POLICY "Public read access for covers"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'covers');

-- Only service role can upload cover images.
-- (Service role bypasses RLS by default, but this policy is explicit
-- so that anon/authenticated users cannot upload.)
CREATE POLICY "Service role upload for covers"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'covers');

-- Service role can overwrite covers (upsert on republish).
CREATE POLICY "Service role update for covers"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'covers');
