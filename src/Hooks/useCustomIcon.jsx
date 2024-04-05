import { useEffect, useRef } from "react";

const useCustomIcon = (styles) => {
  const { primary, secondary } = styles;
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      const shadowRoot =
        ref.current.childNodes[0].shadowRoot ||
        ref.current.childNodes[0].attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.innerHTML = `.primary {
                            stroke: ${primary};
                          }
                          .secondary{
                            stroke: ${secondary}
                          }`;
      shadowRoot.appendChild(style);
    }
  }, [styles]);

  return ref;
};

export default useCustomIcon;
