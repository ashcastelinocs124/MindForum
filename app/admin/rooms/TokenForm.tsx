export default function TokenForm({ error }: { error?: string }) {
  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Admin access</h1>
      <p style={{ color: "#666" }}>Paste the admin token to continue.</p>
      {error === "bad_token" && (
        <p role="alert" style={{ color: "#c00" }}>
          Invalid token.
        </p>
      )}
      <form method="POST" action="/admin/rooms/auth">
        <input
          type="password"
          name="token"
          autoComplete="off"
          autoFocus
          required
          style={{ width: "100%", padding: 8, fontSize: 16 }}
        />
        <button type="submit" style={{ marginTop: 8, padding: "8px 16px" }}>
          Continue
        </button>
      </form>
    </main>
  );
}
