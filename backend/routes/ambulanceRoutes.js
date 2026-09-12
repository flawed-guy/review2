const express = require("express");
const { db } = require("../firebase/firebase");

const router = express.Router();

// Add demo ambulances
router.post("/seed", async (req, res) => {
  try {
    const ambulances = [
      {
        id: "AMB001",
        driverName: "Ravi Kumar",
        vehicleNumber: "TN01AB1234",
        phone: "9000000001",
        status: "AVAILABLE",
        latitude: 12.9716,
        longitude: 79.1580,
      },
      {
        id: "AMB002",
        driverName: "Arun Kumar",
        vehicleNumber: "TN01CD5678",
        phone: "9000000002",
        status: "AVAILABLE",
        latitude: 12.9750,
        longitude: 79.1650,
      },
      {
        id: "AMB003",
        driverName: "Suresh Kumar",
        vehicleNumber: "TN01EF9012",
        phone: "9000000003",
        status: "AVAILABLE",
        latitude: 12.9650,
        longitude: 79.1500,
      },
    ];

    const batch = db.batch();

    ambulances.forEach((ambulance) => {
      const ref = db.collection("ambulances").doc(ambulance.id);
      batch.set(ref, ambulance);
    });

    await batch.commit();

    res.json({
      success: true,
      message: "Demo ambulances added successfully 🚑",
      ambulances,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to seed ambulances",
      error: error.message,
    });
  }
});


// Get all ambulances
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("ambulances").get();

    const ambulances = [];

    snapshot.forEach((doc) => {
      ambulances.push(doc.data());
    });

    res.json({
      success: true,
      count: ambulances.length,
      ambulances,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch ambulances",
      error: error.message,
    });
  }
});

// Reset all demo ambulances for testing
router.post("/reset", async (req, res) => {
  try {
    const snapshot = await db.collection("ambulances").get();

    const batch = db.batch();

    snapshot.forEach((doc) => {
      batch.update(doc.ref, {
        status: "AVAILABLE",
        emergencyId: null,
      });
    });

    await batch.commit();

    res.json({
      success: true,
      message: "All demo ambulances reset to AVAILABLE 🚑",
    });
  } catch (error) {
    console.error("Reset error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to reset ambulances",
      error: error.message,
    });
  }
});

module.exports = router;