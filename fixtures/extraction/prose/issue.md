# User lookup returns the wrong status

When a client calls GET /users/:id with an id that does not exist, the API must return 404. The response body should include the message "user not found".
