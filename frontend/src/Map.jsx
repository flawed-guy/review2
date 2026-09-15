import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

function Map({ userLocation, ambulanceLocation, routeGeometry }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const userMarker = useRef(null);
  const ambulanceMarker = useRef(null);
  const animationFrame = useRef(null);
  const routeProgress = useRef(0); // Track progress along the route

  useEffect(() => {
    if (map.current) return;

    const newMap = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      // Center will be set dynamically when locations are available
      center: [79.15569, 12.96999], // Fallback center
      zoom: 14,
    });

    newMap.addControl(new maplibregl.NavigationControl(), "top-right");
    map.current = newMap;

    // Update map center when user or ambulance location changes
    const updateMapCenter = () => {
      if (!map.current) return;

      let center = [79.15569, 12.96999]; // Default fallback

      if (userLocation) {
        center = [userLocation.longitude, userLocation.latitude];
      } else if (ambulanceLocation) {
        center = [ambulanceLocation.longitude, ambulanceLocation.latitude];
      }

      // If we have both, center between them
      if (userLocation && ambulanceLocation) {
        center = [
          (userLocation.longitude + ambulanceLocation.longitude) / 2,
          (userLocation.latitude + ambulanceLocation.latitude) / 2
        ];
      }

      map.current.setCenter(center, { zoom: 14, duration: 500 });
    };

    // Update center when locations change
    if (userLocation || ambulanceLocation) {
      updateMapCenter();
    }

    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      newMap.remove();
      map.current = null;
    };
  }, [userLocation, ambulanceLocation]);

  useEffect(() => {
    if (!map.current || !userLocation) return;
    const position = [Number(userLocation.longitude), Number(userLocation.latitude)];

    if (!userMarker.current) {
      const element = document.createElement("div");
      element.textContent = "📍";
      element.style.fontSize = "32px";
      userMarker.current = new maplibregl.Marker({ element }).setLngLat(position).addTo(map.current);
    } else {
      userMarker.current.setLngLat(position);
    }
  }, [userLocation]);

  useEffect(() => {
    if (!map.current) return;

    if (!ambulanceLocation) {
      ambulanceMarker.current?.remove();
      ambulanceMarker.current = null;
      routeProgress.current = 0; // Reset progress when ambulance disappears
      return;
    }

    // If we have route geometry, animate along the route
    if (routeGeometry && routeGeometry.coordinates && routeGeometry.coordinates.length >= 2) {
      animateAlongRoute(routeGeometry.coordinates);
    } else {
      // Fallback to direct animation if no route available
      animateDirect(ambulanceLocation);
    }
  }, [ambulanceLocation, routeGeometry]);

  // Animate ambulance along the route geometry
  function animateAlongRoute(coordinates) {
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);

    // Find the closest point on the route to the current ambulance position
    const closestPointIndex = findClosestPointIndex(coordinates, ambulanceLocation);

    // Set target to the next point or end of route
    const targetIndex = Math.min(closestPointIndex + 1, coordinates.length - 1);
    if (targetIndex < closestPointIndex) return; // Already at or past end

    const startPoint = coordinates[closestPointIndex];
    const endPoint = coordinates[targetIndex];

    const startLng = startPoint[0];
    const startLat = startPoint[1];
    const endLng = endPoint[0];
    const endLat = endPoint[1];

    const duration = 1500; // Slightly longer for smoother animation
    const startTime = performance.now();

    const animate = (time) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const currentProgress = closestPointIndex / coordinates.length + (progress / coordinates.length);

      ambulanceMarker.current?.setLngLat([
        startLng + (endLng - startLng) * progress,
        startLat + (endLat - startLat) * progress,
      ]);

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate);
      } else {
        // Move to next segment when current segment is complete
        routeProgress.current = Math.min(currentProgress, 0.99);
      }
    };

    animationFrame.current = requestAnimationFrame(animate);
  }

  // Fallback direct animation (original behavior)
  function animateDirect(ambulanceLocation) {
    if (!ambulanceMarker.current) {
      const element = document.createElement("div");
      element.textContent = "🚑";
      element.style.fontSize = "32px";
      ambulanceMarker.current = new maplibregl.Marker({ element })
        .setLngLat([Number(ambulanceLocation.longitude), Number(ambulanceLocation.latitude)])
        .addTo(map.current);
      return;
    }

    const old = ambulanceMarker.current.getLngLat();
    const startLng = old.lng;
    const startLat = old.lat;
    const endLng = Number(ambulanceLocation.longitude);
    const endLat = Number(ambulanceLocation.latitude);
    const duration = 1000;
    const startTime = performance.now();

    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);

    const animate = (time) => {
      const progress = Math.min((time - startTime) / duration, 1);
      ambulanceMarker.current?.setLngLat([
        startLng + (endLng - startLng) * progress,
        startLat + (endLat - startLat) * progress,
      ]);
      if (progress < 1) animationFrame.current = requestAnimationFrame(animate);
    };

    animationFrame.current = requestAnimationFrame(animate);
  }

  // Helper function to find closest point on route to given location
  function findClosestPointIndex(coordinates, location) {
    if (!location) return 0;

    let minDistance = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < coordinates.length; i++) {
      const point = coordinates[i];
      const distance = Math.sqrt(
        Math.pow(point[0] - location.longitude, 2) +
        Math.pow(point[1] - location.latitude, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  useEffect(() => {
    if (!map.current) return;

    if (!routeGeometry?.coordinates?.length) {
      if (map.current.getLayer("route")) map.current.removeLayer("route");
      if (map.current.getSource("route")) map.current.removeSource("route");
      return;
    }

    const drawRoute = () => {
      if (!map.current) return;
      const data = { type: "Feature", properties: {}, geometry: routeGeometry };

      if (map.current.getSource("route")) {
        map.current.getSource("route").setData(data);
      } else {
        map.current.addSource("route", { type: "geojson", data });
        map.current.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#2563eb", "line-width": 7, "line-opacity": 0.9 },
        });
      }

      const bounds = routeGeometry.coordinates.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(routeGeometry.coordinates[0], routeGeometry.coordinates[0])
      );
      map.current.fitBounds(bounds, { padding: 70, duration: 800 });
    };

    if (map.current.isStyleLoaded()) drawRoute();
    else map.current.once("load", drawRoute);

    return () => map.current?.off("load", drawRoute);
  }, [routeGeometry]);

  return <div ref={mapContainer} style={{ width: "100%", height: "400px", borderRadius: "15px", overflow: "hidden" }} />;
}

export default Map;