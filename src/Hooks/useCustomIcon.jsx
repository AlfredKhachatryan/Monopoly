import { useEffect, useRef } from "react";

const useCustomIcon = (styles) => {
  const { primary, secondary } = styles;
  const iconRef = useRef(null);
  const styleTagRef = useRef(null);
  useEffect(() => {
    if (!styleTagRef.current) {
      const shadowRoot =
        iconRef.current.childNodes[0].shadowRoot ||
        iconRef.current.childNodes[0].attachShadow({ mode: "open" });
      styleTagRef.current = document.createElement("style");
      shadowRoot.appendChild(styleTagRef.current);
    }

    const styleContent = `.primary {
      stroke: ${primary} !important;
      fill: ${primary} !important;
    }
    .secondary {
      stroke: ${secondary} !important;
      fill: ${secondary} !important;
    }`;

    styleTagRef.current.innerHTML = styleContent;
  }, [primary, secondary]);

  return iconRef;
};

export default useCustomIcon;
