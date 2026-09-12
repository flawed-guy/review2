async function getRoute(
  ambulanceLatitude,
  ambulanceLongitude,
  userLatitude,
  userLongitude
) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${ambulanceLongitude},${ambulanceLatitude};` +
    `${userLongitude},${userLatitude}` +
    `?overview=full&geometries=geojson`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("OSRM routing request failed");
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes.length) {
    throw new Error("No route found");
  }

  const route = data.routes[0];

  return {
    distanceKm: Number(
      (route.distance / 1000).toFixed(2)
    ),

    durationMinutes: Math.ceil(
      route.duration / 60
    ),

    geometry: route.geometry,
  };
}

module.exports = {
  getRoute,
};