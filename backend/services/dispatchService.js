const { db } = require("../firebase/firebase");

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

async function findNearestAmbulance(latitude, longitude) {
  const snapshot = await db
    .collection("ambulances")
    .where("status", "==", "AVAILABLE")
    .get();

  if (snapshot.empty) {
    return null;
  }

  let nearestAmbulance = null;
  let shortestDistance = Infinity;

  snapshot.forEach((doc) => {
    const ambulance = doc.data();

    const distance = calculateDistance(
      latitude,
      longitude,
      ambulance.latitude,
      ambulance.longitude
    );

    if (distance < shortestDistance) {
      shortestDistance = distance;

      nearestAmbulance = {
        ...ambulance,
        distanceKm: Number(distance.toFixed(2)),
      };
    }
  });

  return nearestAmbulance;
}

module.exports = {
  findNearestAmbulance,
  calculateDistance,
};