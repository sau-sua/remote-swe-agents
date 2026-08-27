# Slack Bolt interface

This is a Slack bolt app that works as an interface between you and agents.

## Custom agents

Start a new thread with an agent directive to use a custom agent configuration:

```
@remote-swe agent:<name-or-id> <your message>
```

Send `list_agents` to list available custom agents.
