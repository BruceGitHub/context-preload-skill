import { users } from '../src/api/users';

test('users start empty', () => {
  expect(users).toHaveLength(0);
});
