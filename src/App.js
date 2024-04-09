import * as ReactDOM from "react-dom/client";
import { React, useEffect, Component } from "react";
import { useNavigate, BrowserRouter, Routes, Route } from "react-router-dom";

//end of import

//imported CDNs

import "./CDN/bootstrap.min.css";
import "./CDN/fontAwesomePro.css";

//end of import

//imported global style

import "./styles/main.css";

//end of import

import { Main } from "./Pages/about_us";
import { Client1 } from "./Pages/client1";
import { Client2 } from "./Pages/client2";
import { TestDesign } from "./Pages/testDesign";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<TestDesign />} />
        <Route path="2/:id" element={<Client1 />} />
        <Route path="3/:id" element={<Client2 />} />
      </Routes>
    </BrowserRouter>
  );
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

export default App;
