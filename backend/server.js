require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { db } = require("./firebase/firebase");
const ambulanceRoutes = require("./routes/ambulanceRoutes");
const { findNearestAmbulance } = require("./services/dispatchService");
const { getRoute } = require("./services/routeService");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 5000;
const OFFER_TIMEOUT_MS = 30_000;
const ACTIVE_EMERGENCY_STATUSES = [
  "WAITING_FOR_DRIVER",
  "AMBULANCE_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "ARRIVED",
  "PATIENT_ONBOARD",
  "EN_ROUTE_HOSPITAL",
];

app.use(cors());
app.use(express.json());
app.use("/api/ambulances", ambulanceRoutes);

function makeEmergencyId() {
  return `EMG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeTripId() {
  return `TRIP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function expireOffer(emergencyId, ambulanceId) {
  try {
    const ambulanceRef = db.collection("ambulances").doc(ambulanceId);
    const emergencyRef = db.collection("emergencies").doc(emergencyId);

    const result = await db.runTransaction(async (tx) => {
      const ambulanceDoc = await tx.get(ambulanceRef);
      if (!ambulanceDoc.exists) return false;

      const ambulance = ambulanceDoc.data();
      if (
        ambulance.status !== "OFFERED" ||
        ambulance.emergencyId !== emergencyId
      ) {
        return false;
      }

      tx.update(ambulanceRef, {
        status: "AVAILABLE",
        emergencyId: null,
      });

      tx.update(emergencyRef, {
        status: "OFFER_EXPIRED",
      });

      return true;
    });

    if (result) {
      io.to(`emergency:${emergencyId}`).emit("ambulance:offerExpired", {
        emergencyId,
        ambulanceId,
      });
      console.log(`⏰ Offer expired: ${ambulanceId} is AVAILABLE again`);
    }
  } catch (error) {
    console.error("Offer expiration error:", error);
  }
}

app.get("/", (req, res) => {
  res.json({ message: "Ambulance backend is running 🚑" });
});

app.get("/api/test-firebase", async (req, res) => {
  try {
    const testRef = await db.collection("system").add({
      message: "Firebase connected successfully",
      createdAt: new Date(),
    });
    res.json({ success: true, message: "Firebase is working 🚑🔥", documentId: testRef.id });
  } catch (error) {
    console.error("Firebase error:", error);
    res.status(500).json({ success: false, message: "Firebase connection failed", error: error.message });
  }
});

app.post("/api/emergencies", async (req, res) => {
  try {
    const { latitude, longitude, requesterId = "DEMO_REQUESTER" } = req.body;
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: "Valid latitude and longitude are required" });
    }

    // Backend protection against repeated SOS from the same requester.
    const existingSnapshot = await db
      .collection("emergencies")
      .where("requesterId", "==", requesterId)
      .get();

    const existing = existingSnapshot.docs
      .map((doc) => doc.data())
      .find((e) => ACTIVE_EMERGENCY_STATUSES.includes(e.status));

    if (existing) {
      return res.json({
        success: true,
        emergencyId: existing.id,
        status: existing.status,
        duplicate: true,
        location: { latitude: existing.latitude, longitude: existing.longitude },
        ambulanceId: existing.ambulanceId || null,
        message: "An emergency is already active for this requester",
      });
    }

    console.log("🚨 EMERGENCY RECEIVED");
    console.log("Latitude:", lat);
    console.log("Longitude:", lng);

    const emergencyId = makeEmergencyId();
    const ambulance = await findNearestAmbulance(lat, lng);

    if (!ambulance) {
      await db.collection("emergencies").doc(emergencyId).set({
        id: emergencyId,
        requesterId,
        latitude: lat,
        longitude: lng,
        status: "NO_AMBULANCE_AVAILABLE",
        ambulanceId: null,
        createdAt: new Date(),
      });

      return res.json({
        success: true,
        emergencyId,
        status: "NO_AMBULANCE_AVAILABLE",
        location: { latitude: lat, longitude: lng },
      });
    }

    const ambulanceRef = db.collection("ambulances").doc(ambulance.id);
    const emergencyRef = db.collection("emergencies").doc(emergencyId);

    // Atomically reserve the ambulance so two SOS requests cannot claim it.
    const reserved = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ambulanceRef);
      if (!doc.exists || doc.data().status !== "AVAILABLE") return false;

      tx.update(ambulanceRef, {
        status: "OFFERED",
        emergencyId,
      });

      tx.set(emergencyRef, {
        id: emergencyId,
        requesterId,
        latitude: lat,
        longitude: lng,
        status: "WAITING_FOR_DRIVER",
        ambulanceId: ambulance.id,
        createdAt: new Date(),
      });

      return true;
    });

    if (!reserved) {
      return res.json({
        success: true,
        emergencyId,
        status: "NO_AMBULANCE_AVAILABLE",
        location: { latitude: lat, longitude: lng },
      });
    }

    console.log("🚑 NEAREST AMBULANCE FOUND");
    console.log("Ambulance:", ambulance.id);
    console.log("Driver:", ambulance.driverName);
    console.log("Distance:", ambulance.distanceKm, "km");

    io.to(`ambulance:${ambulance.id}`).emit("ambulance:offer", {
      emergencyId,
      pickupLocation: { latitude: lat, longitude: lng },
      ambulance: {
        id: ambulance.id,
        driverName: ambulance.driverName,
        vehicleNumber: ambulance.vehicleNumber,
      },
      distanceKm: ambulance.distanceKm,
    });

    // If nobody accepts, return the ambulance automatically.
    setTimeout(() => expireOffer(emergencyId, ambulance.id), OFFER_TIMEOUT_MS);

    return res.json({
      success: true,
      emergencyId,
      status: "WAITING_FOR_DRIVER",
      location: { latitude: lat, longitude: lng },
      ambulance: {
        id: ambulance.id,
        driverName: ambulance.driverName,
        vehicleNumber: ambulance.vehicleNumber,
        phone: ambulance.phone,
        latitude: ambulance.latitude,
        longitude: ambulance.longitude,
        distanceKm: ambulance.distanceKm,
      },
    });
  } catch (error) {
    console.error("Dispatch error:", error);
    res.status(500).json({ success: false, message: "Failed to dispatch ambulance", error: error.message });
  }
});

app.post("/api/ambulances/:ambulanceId/accept", async (req, res) => {
  try {
    const { ambulanceId } = req.params;
    const { emergencyId } = req.body;
    if (!emergencyId) return res.status(400).json({ success: false, message: "Emergency ID is required" });

    const ambulanceRef = db.collection("ambulances").doc(ambulanceId);
    const emergencyRef = db.collection("emergencies").doc(emergencyId);
    const tripId = makeTripId();

    const ambulance = await db.runTransaction(async (tx) => {
      const ambulanceDoc = await tx.get(ambulanceRef);
      const emergencyDoc = await tx.get(emergencyRef);

      if (!ambulanceDoc.exists) throw new Error("__AMBULANCE_NOT_FOUND__");
      if (!emergencyDoc.exists) throw new Error("__EMERGENCY_NOT_FOUND__");

      const data = ambulanceDoc.data();
      const emergency = emergencyDoc.data();

      if (data.status !== "OFFERED" || data.emergencyId !== emergencyId) {
        throw new Error("__OFFER_NOT_AVAILABLE__");
      }

      tx.update(ambulanceRef, { status: "ACCEPTED" });
      tx.update(emergencyRef, { status: "AMBULANCE_ASSIGNED", tripId });

      return data;
    }).catch((error) => {
      if (error.message === "__AMBULANCE_NOT_FOUND__") return { error: "AMBULANCE_NOT_FOUND" };
      if (error.message === "__EMERGENCY_NOT_FOUND__") return { error: "EMERGENCY_NOT_FOUND" };
      if (error.message === "__OFFER_NOT_AVAILABLE__") return { error: "OFFER_NOT_AVAILABLE" };
      throw error;
    });

    if (ambulance.error) {
      const map = {
        AMBULANCE_NOT_FOUND: [404, "Ambulance not found"],
        EMERGENCY_NOT_FOUND: [404, "Emergency not found"],
        OFFER_NOT_AVAILABLE: [409, "This ambulance offer is no longer available"],
      };
      const [code, message] = map[ambulance.error];
      return res.status(code).json({ success: false, message });
    }

    const emergencyDoc = await emergencyRef.get();
    const emergency = emergencyDoc.data();

    await db.collection("trips").doc(tripId).set({
      id: tripId,
      emergencyId,
      ambulanceId,
      driverId: ambulanceId,
      pickupLat: emergency.latitude,
      pickupLng: emergency.longitude,
      hospitalId: null,
      status: "ACCEPTED",
      startedAt: new Date(),
      pickupAt: null,
      hospitalArrivalAt: null,
      completedAt: null,
    });

    io.to(`requester:${emergency.requesterId}`).emit("ambulance:accepted", {
      emergencyId,
      ambulance: {
        id: ambulance.id,
        driverName: ambulance.driverName,
        vehicleNumber: ambulance.vehicleNumber,
        phone: ambulance.phone,
      },
    });
    io.to(`emergency:${emergencyId}`).emit("ambulance:accepted", {
      emergencyId,
      ambulance: {
        id: ambulance.id,
        driverName: ambulance.driverName,
        vehicleNumber: ambulance.vehicleNumber,
        phone: ambulance.phone,
      },
    });

    console.log(`✅ ${ambulanceId} accepted emergency ${emergencyId}`);
    res.json({ success: true, message: "Emergency accepted successfully", emergencyId, ambulanceId, tripId, status: "AMBULANCE_ASSIGNED" });
  } catch (error) {
    console.error("Accept error:", error);
    res.status(500).json({ success: false, message: "Failed to accept emergency", error: error.message });
  }
});

const transitions = {
  ACCEPTED: ["EN_ROUTE_PICKUP"],
  EN_ROUTE_PICKUP: ["ARRIVED"],
  ARRIVED: ["PATIENT_ONBOARD"],
  PATIENT_ONBOARD: ["EN_ROUTE_HOSPITAL"],
  EN_ROUTE_HOSPITAL: ["COMPLETED"],
};

app.post("/api/trips/:tripId/status", async (req, res) => {
  try {
    const { tripId } = req.params;
    const { status } = req.body;
    const tripRef = db.collection("trips").doc(tripId);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) return res.status(404).json({ success: false, message: "Trip not found" });

    const trip = tripDoc.data();
    if (!transitions[trip.status]?.includes(status)) {
      return res.status(409).json({ success: false, message: `Invalid trip transition: ${trip.status} → ${status}` });
    }

    const updates = { status };
    if (status === "ARRIVED") updates.pickupAt = new Date();
    if (status === "COMPLETED") updates.completedAt = new Date();
    await tripRef.update(updates);

    if (status === "COMPLETED") {
      await db.collection("ambulances").doc(trip.ambulanceId).update({ status: "AVAILABLE", emergencyId: null });
      await db.collection("emergencies").doc(trip.emergencyId).update({ status: "COMPLETED" });
      console.log(`♻️ ${trip.ambulanceId} is AVAILABLE again`);
    }

    io.to(`emergency:${trip.emergencyId}`).emit("trip:status", {
      tripId,
      emergencyId: trip.emergencyId,
      ambulanceId: trip.ambulanceId,
      status,
    });

    const emergencyDoc = await db.collection("emergencies").doc(trip.emergencyId).get();
    if (emergencyDoc.exists) {
      io.to(`requester:${emergencyDoc.data().requesterId}`).emit("trip:status", {
        tripId,
        emergencyId: trip.emergencyId,
        ambulanceId: trip.ambulanceId,
        status,
      });
    }

    console.log(`🚑 Trip ${tripId} → ${status}`);
    res.json({ success: true, tripId, status });
  } catch (error) {
    console.error("Trip status error:", error);
    res.status(500).json({ success: false, message: "Failed to update trip status", error: error.message });
  }
});

app.get("/api/route", async (req, res) => {
  try {
    const { ambulanceLat, ambulanceLng, userLat, userLng } = req.query;
    const values = [ambulanceLat, ambulanceLng, userLat, userLng].map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      return res.status(400).json({ success: false, message: "Valid ambulance and user coordinates are required" });
    }

    const route = await getRoute(values[0], values[1], values[2], values[3]);
    res.json({ success: true, route });
  } catch (error) {
    console.error("Route error:", error);
    res.status(500).json({ success: false, message: "Failed to calculate route", error: error.message });
  }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("driver:register", async (ambulanceId) => {
    if (!ambulanceId) return;
    socket.join(`ambulance:${ambulanceId}`);
    console.log(`🚑 Driver registered: ${ambulanceId}`);

    // If the driver reconnects while an offer is waiting, resend it.
    try {
      const ambulanceDoc = await db.collection("ambulances").doc(ambulanceId).get();
      if (!ambulanceDoc.exists) return;
      const ambulance = ambulanceDoc.data();
      if (ambulance.status !== "OFFERED" || !ambulance.emergencyId) return;

      const emergencyDoc = await db.collection("emergencies").doc(ambulance.emergencyId).get();
      if (!emergencyDoc.exists) return;
      const emergency = emergencyDoc.data();

      socket.emit("ambulance:offer", {
        emergencyId: emergency.id,
        pickupLocation: { latitude: emergency.latitude, longitude: emergency.longitude },
        ambulance: {
          id: ambulance.id,
          driverName: ambulance.driverName,
          vehicleNumber: ambulance.vehicleNumber,
        },
        distanceKm: Number((require("./services/dispatchService").calculateDistance(
          ambulance.latitude,
          ambulance.longitude,
          emergency.latitude,
          emergency.longitude
        )).toFixed(2)),
      });
    } catch (error) {
      console.error("Driver registration recovery error:", error);
    }
  });

  socket.on("requester:register", (requesterId) => {
    if (!requesterId) return;
    socket.join(`requester:${requesterId}`);
    console.log(`📱 Requester registered: ${requesterId}`);
  });

  socket.on("emergency:join", (emergencyId) => {
    if (!emergencyId) return;
    socket.join(`emergency:${emergencyId}`);
    console.log(`🚨 Requester joined emergency: ${emergencyId}`);
  });

  socket.on("driver:location", async (data) => {
    try {
      const ambulanceId = data?.ambulanceId;
      const latitude = Number(data?.latitude);
      const longitude = Number(data?.longitude);
      if (!ambulanceId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const ambulanceRef = db.collection("ambulances").doc(ambulanceId);
      const ambulanceDoc = await ambulanceRef.get();
      if (!ambulanceDoc.exists) return;
      const ambulance = ambulanceDoc.data();

      await ambulanceRef.update({ latitude, longitude });

      if (ambulance.emergencyId) {
        io.to(`emergency:${ambulance.emergencyId}`).emit("ambulance:location", {
          ambulanceId,
          latitude,
          longitude,
        });
      }
    } catch (error) {
      console.error("Driver location error:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
