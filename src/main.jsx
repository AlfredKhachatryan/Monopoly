import { createRoot } from "react-dom/client";
import React, { useEffect, Component } from "react";
import { useNavigate, BrowserRouter, Routes, Route } from "react-router-dom";

//end of import

//imported CDNs

import "./CDN/bootstrap.min.css";
// import "./CDN/fontAwesomePro.css";

//end of import

//imported global style

import "./styles/main.css";

//end of import

import { Main } from "./Pages/Board";
import { Client } from "./Pages/Client";
import { Login } from "./Pages/Login";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<Main />} />
        <Route path="/Client" element={<Client />} />
        <Route path="/Login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
const root = createRoot(document.getElementById("root"));
root.render(<App />);

export default App;
