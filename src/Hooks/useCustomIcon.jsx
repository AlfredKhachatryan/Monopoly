import { useEffect, useRef } from "react";

const useCustomIcon = (styles) => {
  const { primary, secondary } = styles;
  const ref = useRef(null);
  const styleRef = useRef(null);
  useEffect(() => {
    if (!styleRef.current) {
      const shadowRoot =
        ref.current.childNodes[0].shadowRoot ||
        ref.current.childNodes[0].attachShadow({ mode: "open" });
      styleRef.current = document.createElement("style");
      shadowRoot.appendChild(styleRef.current);
    }
    if (styleRef.current) {
      styleRef.current.innerHTML = `.primary {
        stroke: ${primary};
      }
      .secondary{
        stroke: ${secondary}
      }`;
    }
  }, [primary, secondary]);

  return ref;
};

export default useCustomIcon;
