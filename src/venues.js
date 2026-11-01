'use strict';

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

const SEARCH_TERMS = {
  wedding: 'wedding venues',
  birthday: 'birthday party venues',
  community: 'community event venues',
};

/**
 * Returns live venue recommendations for an event when Places is configured.
 * @param {{type: string, city?: string}} event Event details.
 * @returns {Promise<object>} Availability and matching venues.
 */
async function getVenueRecommendations(event) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { available: false, items: [], reason: 'not_configured' };
  const city = event.city || 'Pune';
  const cacheKey = `${event.type}:${city.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.priceLevel,places.photos',
    },
    body: JSON.stringify({
      textQuery: `${SEARCH_TERMS[event.type]} in ${city}`,
      maxResultCount: 6,
      languageCode: 'en',
      regionCode: 'IN',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Places search returned ${response.status}`);
  const data = await response.json();
  const places = (Array.isArray(data.places) ? data.places : []).slice(0, 6);
  const items = await Promise.all(
    places.map(async (place) => {
      const photoName = place.photos?.[0]?.name;
      let photoUrl = null;
      if (photoName) {
        try {
          photoUrl = await getPhotoUrl(photoName, apiKey);
        } catch (err) {
          console.error('Venue photo unavailable:', err.message);
        }
      }
      return {
        id: place.id,
        name: place.displayName?.text || 'Venue',
        address: place.formattedAddress || city,
        mapsUrl:
          place.googleMapsUri ||
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName?.text || city)}`,
        rating: Number.isFinite(place.rating) ? place.rating : null,
        reviewCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount : null,
        priceLevel: place.priceLevel || null,
        photoUrl,
        attribution: place.photos?.[0]?.authorAttributions?.[0]?.displayName || null,
      };
    }),
  );
  const value = { available: true, items, reason: items.length ? null : 'no_results' };
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { value, expires: Date.now() + CACHE_MS });
  return value;
}

async function getPhotoUrl(photoName, apiKey) {
  if (
    typeof photoName !== 'string' ||
    !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)
  )
    return null;
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set('maxWidthPx', '900');
  url.searchParams.set('skipHttpRedirect', 'true');
  url.searchParams.set('key', apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Places photo returned ${response.status}`);
  const data = await response.json();
  return typeof data.photoUri === 'string' && data.photoUri.startsWith('https://')
    ? data.photoUri
    : null;
}

module.exports = { getVenueRecommendations };
