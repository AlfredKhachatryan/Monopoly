// import the required react libraries
import React, { useEffect, useState } from "react";

function Test() {
  // const variable array to save the users location
  const [userCoord, setUseCoord] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  useEffect(() => {
    if (weatherData) {
      console.log(weatherData);
    }
    if (userLocation) {
      console.log(userLocation);
    }
  }, [weatherData, userLocation]);
  // define the function that finds the users geolocation
  const getUserLocation = () => {
    // if geolocation is supported by the users browser
    if (navigator.geolocation) {
      // get the current users location
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // save the geolocation coordinates in two variables
          const { latitude, longitude } = position.coords;
          // update the value of userlocation variable
          setUseCoord({ latitude, longitude });
          getWeatherData(latitude, longitude);
          getLocationData(latitude, longitude);
        },

        // if there was an error getting the users location
        (error) => {
          console.error("Error getting user location:", error);
        }
      );
    }
    // if geolocation is not supported by the users browser
    else {
      console.error("Geolocation is not supported by this browser.");
    }
  };

  const getWeatherData = (lat, lon) => {
    const apiKey = "RM6TEEP8AGFTDPLV26AF2S94D"; // Your OpenWeatherMap API key
    const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?unitGroup=metric&key=${apiKey}&contentType=json`;
    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        setWeatherData(data);
      })
      .catch((error) => {
        console.error("Error fetching weather data:", error);
      });
  };

  const getLocationData = (lat, lon) => {
    const apiKey = "b8568cb9afc64fad861a69edbddb2658";
    const reverseGeocodingUrl = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${apiKey}`;

    fetch(reverseGeocodingUrl)
      .then((response) => response.json())
      .then((data) => {
        setUserLocation(data);
      })
      .catch((error) => {
        console.error("Error fetching weather data:", error);
      });
  };

  return (
    <div>
      <h1>Geolocation App</h1>
      <button onClick={getUserLocation}>Get User Location</button>
      {/* if the user location variable has a value, print the users location */}
      {userCoord && (
        <div>
          <h2>User Location</h2>
          <p>Latitude: {userCoord.latitude}</p>
          <p>Longitude: {userCoord.longitude}</p>
        </div>
      )}
    </div>
  );
}

export { Test };
