// Centre-of-board panel. Shows the deck name, or the last card drawn from
// that deck and who drew it.
function Chance({ txt, card, by }) {
  const showCard = !!card;
  return (
    <div
      style={{
        padding: showCard ? "1.5rem" : "2rem",
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#15131b",
        position: "relative",
        color: "#f5f5f5",
        overflow: "hidden",
        textAlign: "center",
        fontSize: showCard ? "1em" : "2em",
        boxShadow: "0px 0px 15px 0px #eb476d85",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          border: "1px solid #eb476d",
          position: "absolute",
          pointerEvents: "none",
        }}
      ></div>
      {showCard ? (
        <>
          <div style={{ fontSize: "0.8em", opacity: 0.6, marginBottom: "0.4em" }}>
            {txt}
            {by ? ` · ${by}` : ""}
          </div>
          <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{card}</div>
        </>
      ) : (
        txt
      )}
    </div>
  );
}
export { Chance };
