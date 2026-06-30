# Family Groups

## Overview

NikoFin supports family groups, allowing multiple users to share expenses, cards, investments, and dashboard data. A group consists of up to 5 members, with one creator and invited members.

## How It Works

### Creating a Group

When a user creates a group:

1. A `Group` record is created
2. The creator becomes a member with role "member" and status "accepted"
3. An 8-character invite code is generated
4. The code can be shared with family members

### Inviting Members

1. Share the 8-character invite code
2. Invited user enters the code via the web app
3. A `GroupMember` record is created with status "pending"
4. The invited user receives a `group_invitation` notification

### Accepting/Rejecting

Members can accept or reject invitations:

- **Via notification panel**: Click "Aceptar" or "Rechazar" on the invitation notification
- **Via API**: `POST /notifications/{id}/accept` or `POST /notifications/{id}/reject`

### Data Sharing

Once accepted, all group members see shared data:

- **Expenses**: Queried for all member user IDs
- **Cards**: Visible across members
- **Investments**: Shared portfolio view
- **Dashboard**: Aggregated data from all members

The `get_group_user_ids()` function returns all accepted member IDs for queries.

## Constraints

- **Max 5 members** per group
- **One group per user**: A user can only belong to one group at a time
- **Status lifecycle**: pending → accepted (or rejected/deleted)
- **Role**: Default "member" role for all non-creator members

## Holder Field

Cards have a `holder` field for per-person tracking within a group:

- Each member's cards can have their own holder name
- Expenses can be filtered by holder (person)
- Dashboard shows spending by person

## Notifications

Group-related notifications:

- `group_invitation`: Sent when invited to a group
- Includes inviter name and group ID
- Accept/reject buttons in notification panel
- Auto-deleted after acceptance/rejection

## API Endpoints

| Method   | Endpoint               | Description               |
| -------- | ---------------------- | ------------------------- |
| `POST`   | `/groups`              | Create a new group        |
| `POST`   | `/groups/join`         | Join group by invite code |
| `POST`   | `/groups/leave`        | Leave current group       |
| `GET`    | `/groups`              | Get current group info    |
| `GET`    | `/groups/members`      | List group members        |
| `DELETE` | `/groups/members/{id}` | Remove a member           |

## Database Schema

```sql
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    created_by INTEGER REFERENCES users(id)
);

CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id),
    user_id INTEGER REFERENCES users(id),
    role VARCHAR DEFAULT 'member',
    status VARCHAR DEFAULT 'pending',
    invited_by INTEGER REFERENCES users(id),
    joined_at TIMESTAMP
);
```
