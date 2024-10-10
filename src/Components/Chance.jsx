function Chance({ txt, rest }) {
  return (
    <div
      style={{
        padding: "2rem",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#15131b",
        position: "relative",
        color: "#f5f5f5",
        wordBreak: "break-all",
        overflow: "hidden",
        fontSize: "2em",
        boxShadow: "0px 0px 15px 0px #eb476d85",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          border: "1px solid #eb476d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "absolute",
        }}
      ></div>
      {txt}
    </div>
  );
}
export { Chance };
