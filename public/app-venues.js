function renderVenues(d) {
  const s = section('Real venues near your celebration');
  const venues = d.venues || { items: [], reason: 'not_configured' };
  if (venues.available && venues.items.length) {
    s.append(
      el(
        'p',
        'section-note',
        `Live Google Maps listings for ${d.event.city || 'Pune'} · check availability and pricing directly with each venue.`,
      ),
    );
    const grid = el('div', 'venue-grid');
    venues.items.forEach((venue) => {
      const card = el('article', 'venue-card');
      const visual = el('div', 'venue-photo');
      if (venue.photoUrl) {
        const image = el('img');
        image.src = venue.photoUrl;
        image.alt = `${venue.name} venue photo`;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => {
          image.remove();
          visual.append(el('span', 'photo-placeholder', 'Venue photo unavailable'));
        };
        visual.append(image);
      } else visual.append(el('span', 'photo-placeholder', 'No venue photo available'));
      const body = el('div', 'venue-body');
      body.append(el('h3', '', venue.name), el('p', 'venue-address', venue.address));
      if (venue.rating)
        body.append(
          el(
            'p',
            'venue-rating',
            `★ ${venue.rating.toFixed(1)}${venue.reviewCount ? ` · ${venue.reviewCount.toLocaleString('en-IN')} reviews` : ''}`,
          ),
        );
      const link = el('a', 'map-link', 'View venue on Google Maps ↗');
      link.href = venue.mapsUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      body.append(link);
      body.append(
        el(
          'small',
          'photo-credit',
          venue.attribution
            ? `Photo: ${venue.attribution} · Google`
            : 'Venue photo via Google Maps',
        ),
      );
      card.append(visual, body);
      grid.append(card);
    });
    s.append(grid);
  } else {
    const city = d.event.city || 'Pune';
    const copy =
      venues.reason === 'not_configured'
        ? 'Live venue photos need a Google Places API key. Meanwhile, browse real local listings and photos on Google Maps.'
        : venues.reason === 'no_results'
          ? `No live matches came back for ${city}. Try a broader nearby city or browse Google Maps.`
          : 'Live venue search is temporarily unavailable. You can still browse current local listings on Google Maps.';
    s.append(el('p', 'section-note', copy));
    const link = el('a', 'btn map-search', `Explore venues in ${city} ↗`);
    link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.event.type} event venues in ${city}`)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    s.append(link);
  }
  return s;
}
