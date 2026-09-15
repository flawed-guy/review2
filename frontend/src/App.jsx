import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Map from "./Map";

const API = "http://localhost:5000";

function RootApp() {
  if (window.location.pathname === "/driver") {
    return <DriverApp />;
  }
  return <RequesterApp />;
}

function DriverApp() {
  // Ambulance ID - change this to test different ambulances (AMB001, AMB002, AMB003, AMB004)
  // For testing multiple ambulances, open multiple browser instances with different IDs
  const ambulanceId = "AMB001"; // <-- CHANGE THIS TO TEST DIFFERENT AMBULANCES
  const [offer, setOffer] = useState(null);
  const [status, setStatus] = useState("DRIVER_ONLINE");
  const [tripId, setTripId] = useState(null);

  useEffect(() => {
    const socket = io(API, { transports: ["websocket"] });

    const register = () => {
      console.log("🚑 DRIVER SOCKET CONNECTED:", socket.id);
      socket.emit("driver:register", ambulanceId);
    };

    socket.on("connect", register);

    socket.on("ambulance:offer", (data) => {
      console.log("🚨 NEW EMERGENCY OFFER:", data);
      setOffer(data);
      setStatus("NEW_EMERGENCY");
    });

    socket.on("ambulance:offerExpired", (data) => {
      console.log("⏰ OFFER EXPIRED:", data);
      setOffer(null);
      setStatus("DRIVER_ONLINE");
    });

    socket.on("disconnect", (reason) => {
      console.log("❌ DRIVER SOCKET DISCONNECTED:", reason);
    });

    // ==========================================
// DEMO DRIVER GPS
// ==========================================

    let demoLatitude = 12.9716;
    let demoLongitude = 79.1580;

    const sendDemoLocation = () => {
      console.log(
        "📍 Demo Driver GPS:",
        demoLatitude,
        demoLongitude
      );

      if (socket.connected) {
        socket.emit("driver:location", {
          ambulanceId,
          latitude: demoLatitude,
          longitude: demoLongitude,
        });
      }
    };

// Send initial driver location
sendDemoLocation();

// Simulate ambulance movement
const locationInterval = setInterval(() => {
  demoLatitude -= 0.00002;
  demoLongitude -= 0.00001;

  sendDemoLocation();
}, 2000);

    return () => {
      clearInterval(locationInterval);
      socket.disconnect();
    };
  }, []);

  const acceptEmergency = async () => {
    if (!offer) return;
    try {
      setStatus("ACCEPTING...");
      const response = await fetch(`${API}/api/ambulances/${ambulanceId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergencyId: offer.emergencyId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setStatus(data.message || "ACCEPT_FAILED");
        return;
      }
      setTripId(data.tripId);
      setOffer(null);
      setStatus("ACCEPTED");
    } catch (error) {
      console.error(error);
      setStatus("ACCEPT_FAILED");
    }
  };

  const declineEmergency = async () => {
    if (!offer) return;
    try {
      setStatus("DECLINING...");
      const response = await fetch(`${API}/api/ambulances/${ambulanceId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergencyId: offer.emergencyId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setStatus(data.message || "DECLINE_FAILED");
        return;
      }
      setOffer(null);
      setStatus("DRIVER_ONLINE");
    } catch (error) {
      console.error(error);
      setStatus("DECLINE_FAILED");
    }
  };

  const updateTripStatus = async (newStatus) => {
    if (!tripId) return;
    try {
      const response = await fetch(`${API}/api/trips/${tripId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        console.error(data.message || "Trip status update failed");
        return;
      }
      if (newStatus === "COMPLETED") {
        setTripId(null);
        setOffer(null);
        setStatus("DRIVER_ONLINE");
      } else {
        setStatus(newStatus);
      }
    } catch (error) {
      console.error("Trip status error:", error);
    }
  };

  return (
    <div style={pageStyle}>
      <h1>🚑 Ambulance Driver</h1>
      <h2>Ambulance: {ambulanceId}</h2>
      <h3>{status}</h3>

      {offer && (
        <div style={cardStyle}>
          <h2>🚨 EMERGENCY REQUEST</h2>
          <p><strong>Emergency ID:</strong><br />{offer.emergencyId}</p>
          <p><strong>Distance:</strong><br />{offer.distanceKm} km</p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button style={acceptButtonStyle} onClick={acceptEmergency}>✅ ACCEPT</button>
            <button style={{ ...acceptButtonStyle, backgroundColor: "#dc2626" }} onClick={declineEmergency}>❌ DECLINE</button>
          </div>
        </div>
      )}

      {tripId && (
        <div style={buttonColumnStyle}>
          {status === "ACCEPTED" && <button onClick={() => updateTripStatus("EN_ROUTE_PICKUP")}>🚑 START TRIP</button>}
          {status === "EN_ROUTE_PICKUP" && <button onClick={() => updateTripStatus("ARRIVED")}>📍 ARRIVED AT PICKUP</button>}
          {status === "ARRIVED" && <button onClick={() => updateTripStatus("PATIENT_ONBOARD")}>🧑‍⚕️ PATIENT ONBOARD</button>}
          {status === "PATIENT_ONBOARD" && <button onClick={() => updateTripStatus("EN_ROUTE_HOSPITAL")}>🏥 GO TO HOSPITAL</button>}
          {status === "EN_ROUTE_HOSPITAL" && <button onClick={() => updateTripStatus("COMPLETED")}>✅ COMPLETE TRIP</button>}
        </div>
      )}
    </div>
  );
}

function RequesterApp() {
  const [status, setStatus] = useState("READY");
  const [emergency, setEmergency] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [ambulanceLocation, setAmbulanceLocation] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);

  const socketRef = useRef(null);
  const requesterIdRef = useRef(null);
  const userRef = useRef(null);
  const ambulanceRef = useRef(null);
  const lastRouteAtRef = useRef(0);
  const routeBusyRef = useRef(false);

  if (!requesterIdRef.current) {
    const saved = localStorage.getItem("ambulanceRequesterId");
    const id = saved || `REQ-${crypto.randomUUID()}`;
    requesterIdRef.current = id;
    localStorage.setItem("ambulanceRequesterId", id);
  }

  useEffect(() => {
    userRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    ambulanceRef.current = ambulanceLocation;
  }, [ambulanceLocation]);

  const fetchRoute = async () => {
    const user = userRef.current;
    const ambulance = ambulanceRef.current;
    if (!user || !ambulance || routeBusyRef.current) return;

    const now = Date.now();
    if (now - lastRouteAtRef.current < 10000) return;

    routeBusyRef.current = true;
    lastRouteAtRef.current = now;

    try {
      const params = new URLSearchParams({
        ambulanceLat: String(ambulance.latitude),
        ambulanceLng: String(ambulance.longitude),
        userLat: String(user.latitude),
        userLng: String(user.longitude),
      });

      const response = await fetch(`${API}/api/route?${params}`);
      const data = await response.json();

      if (response.ok && data.success) {
        console.log("🛣️ ROUTE:", data.route);
        setRouteGeometry(data.route.geometry);
        setRouteInfo({
          distanceKm: data.route.distanceKm,
          durationMinutes: data.route.durationMinutes,
        });
      }
    } catch (error) {
      console.error("Route request failed:", error);
    } finally {
      routeBusyRef.current = false;
    }
  };

  useEffect(() => {
    const socket = io(API, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("📱 REQUESTER SOCKET CONNECTED:", socket.id);
      socket.emit("requester:register", requesterIdRef.current);
    });

    socket.on("ambulance:accepted", (data) => {
      console.log("🚑 AMBULANCE ACCEPTED:", data);
      setEmergency((previous) => ({
        ...(previous || {}),
        status: "AMBULANCE_ASSIGNED",
        ambulance: data.ambulance,
      }));
      setStatus("AMBULANCE_ASSIGNED");
    });

    socket.on("ambulance:location", (data) => {
      setAmbulanceLocation({
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
      });
    });

    socket.on("trip:status", (data) => {
      setStatus(data.status);
      setEmergency((previous) => ({ ...(previous || {}), status: data.status }));
      if (data.status === "COMPLETED") {
        setAmbulanceLocation(null);
        setRouteGeometry(null);
        setRouteInfo(null);
      }
    });

    socket.on("ambulance:offerExpired", () => {
      setStatus("OFFER_EXPIRED");
      setEmergency((previous) => ({ ...(previous || {}), status: "OFFER_EXPIRED" }));
    });

    socket.on("ambulance:lookingForDriver", (data) => {
      console.log("Looking for another driver:", data.message);
      setStatus("LOOKING_FOR_DRIVER");
      setEmergency((previous) => ({
        ...(previous || {}),
        status: "LOOKING_FOR_DRIVER",
        lookingForDriverMessage: data.message
      }));
    });

    socket.on("ambulance:notAvailable", (data) => {
      console.log("No ambulances available:", data.message);
      setStatus("NO_AMBULANCE_AVAILABLE");
      setEmergency((previous) => ({
        ...(previous || {}),
        status: "NO_AMBULANCE_AVAILABLE",
        notAvailableMessage: data.message
      }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    fetchRoute();
  }, [userLocation, ambulanceLocation]);

  useEffect(() => {
    const timer = setInterval(fetchRoute, 15000);
    return () => clearInterval(timer);
  }, []);

  const requestAmbulance = () => {
    if (emergency && !["COMPLETED", "OFFER_EXPIRED"].includes(status)) {
      console.log("⚠️ Emergency already active");
      return;
    }

    setStatus("GETTING_LOCATION...");
    setRouteGeometry(null);
    setRouteInfo(null);
    setAmbulanceLocation(null);

    if (!navigator.geolocation) {
      setStatus("GPS_NOT_SUPPORTED");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        setUserLocation(location);
        setStatus("SENDING_EMERGENCY...");

        try {
          const response = await fetch(`${API}/api/emergencies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...location, requesterId: requesterIdRef.current }),
          });
          const data = await response.json();

          if (!response.ok) {
            setStatus(data.message || "DISPATCH_FAILED");
            return;
          }

          setEmergency(data);
          setStatus(data.status);

          if (data.ambulance) {
            setAmbulanceLocation({
              latitude: Number(data.ambulance.latitude),
              longitude: Number(data.ambulance.longitude),
            });
          }

          socketRef.current?.emit("emergency:join", data.emergencyId);
        } catch (error) {
          console.error(error);
          setStatus("BACKEND_CONNECTION_FAILED");
        }
      },
      (error) => {
        console.error(error);
        setStatus("LOCATION_PERMISSION_DENIED");
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  };

  return (
    <div style={pageStyle}>
      <h1>🚑 Emergency Ambulance</h1>
      <button onClick={requestAmbulance} style={sosStyle}>🚨<br />SOS</button>
      <h2>{status}</h2>

      {routeInfo && (
        <div style={etaCardStyle}>
          <strong>🚑 Ambulance Route</strong>
          <div>📏 {routeInfo.distanceKm} km</div>
          <div>⏱️ ETA: {routeInfo.durationMinutes} min</div>
        </div>
      )}

      <div style={{ width: "90%", maxWidth: "800px", marginTop: "20px" }}>
        <Map userLocation={userLocation} ambulanceLocation={ambulanceLocation} routeGeometry={routeGeometry} />
      </div>

      {emergency && (
        <div style={cardStyle}>
          <p><strong>Emergency ID:</strong> {emergency.emergencyId}</p>
          <p><strong>Status:</strong> {emergency.status}</p>
          {emergency.ambulance && (
            <div>
              <h2>🚑 Ambulance</h2>
              <p><strong>Driver:</strong> {emergency.ambulance.driverName}</p>
              <p><strong>Vehicle:</strong> {emergency.ambulance.vehicleNumber}</p>
              <p><strong>Phone:</strong> {emergency.ambulance.phone}</p>
              {emergency.status === "AMBULANCE_ASSIGNED" ? <h3>✅ Driver Accepted</h3> : emergency.status === "OFFER_EXPIRED" ? <h3>⏰ Offer expired</h3> : emergency.status === "LOOKING_FOR_DRIVER" ? <h3>🔍 {emergency.lookingForDriverMessage || 'Looking for another driver...'}</h3> : emergency.status === "NO_AMBULANCE_AVAILABLE" ? <h3>❌ {emergency.notAvailableMessage || 'No ambulances available'}</h3> : <h3>⏳ Waiting for Driver to Accept...</h3>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const pageStyle = { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "Arial", padding: "20px" };
const sosStyle = { width: "220px", height: "220px", borderRadius: "50%", border: "none", backgroundColor: "red", color: "white", fontSize: "32px", fontWeight: "bold", cursor: "pointer" };
const cardStyle = { marginTop: "20px", padding: "20px", border: "2px solid #444", borderRadius: "15px", textAlign: "center", width: "min(90%, 420px)" };
const etaCardStyle = { ...cardStyle, border: "2px solid #2563eb" };
const buttonColumnStyle = { marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px", width: "300px" };
const acceptButtonStyle = { width: "250px", padding: "18px", backgroundColor: "green", color: "white", border: "none", borderRadius: "10px", fontSize: "22px", cursor: "pointer" };

export default RootApp;
