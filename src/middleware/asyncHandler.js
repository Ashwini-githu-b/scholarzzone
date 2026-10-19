// Express 4 does not forward rejected async route promises automatically.
module.exports = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
