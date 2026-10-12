'use strict';

/** Błąd, którego treść można pokazać użytkownikowi (HTTP 400). */
class UserError extends Error {
  /** Rzuca błąd z komunikatem; wygodne w wyrażeniach typu `x || UserError.fail('…')`. */
  static fail(message) {
    throw new UserError(message);
  }
}

module.exports = UserError;
