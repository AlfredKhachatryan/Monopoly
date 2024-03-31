import * as ReactDOM from 'react-dom/client';
import {React, useEffect,Component} from 'react';
import {useNavigate, BrowserRouter, Routes, Route } from "react-router-dom";

//end of import



//imported CDNs

import './CDN/bootstrap.min.css'
import './CDN/fontAwesomePro.css'

//end of import

//imported global style

import './styles/main.css'

//end of import

import { Main } from './Pages/about_us';


function App() {
  
  return (
    
  <BrowserRouter>

    <Routes>

      <Route index element={<Main/>}/>

    </Routes> 

  </BrowserRouter> 

  );
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

export default App;
