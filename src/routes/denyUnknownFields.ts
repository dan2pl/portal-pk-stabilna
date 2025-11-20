export function denyUnknownFields(allowed) {
  return (req, res, next) => {
    try {
      const body = req.body || {};
      const unknown = Object.keys(body).filter(k => !allowed.includes(k));

      if (unknown.length > 0) {
        return res.status(400).json({
          error: "Niedozwolone pola w żądaniu",
          fields: unknown
        });
      }
    } catch (e) {
      console.warn("denyUnknownFields error:", e);
    }

    next();
  };
}
