export const VLB_TRIP_HANDOVER_SCHEMA=`
 CREATE OR REPLACE FUNCTION mis_vlb_has_handover_trip(card jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $handover$
  SELECT EXISTS (
   SELECT 1
   FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(card->'trips')='array' THEN card->'trips' END
   ) AS trip
   WHERE (COALESCE(trip->>'loadingTime','')='') <> (COALESCE(trip->>'unloadingTime','')='')
      OR trip->'timeEstimates'->'loadingTime' IS NOT NULL
  );
 $handover$;

 CREATE INDEX IF NOT EXISTS mis_log_books_vlb_handover
 ON mis_log_books (site,book_date)
 WHERE book_type='vehicle' AND deleted_at IS NULL AND mis_vlb_has_handover_trip(data);

 CREATE INDEX IF NOT EXISTS mis_log_books_date_site
 ON mis_log_books (book_date,site);
`;
