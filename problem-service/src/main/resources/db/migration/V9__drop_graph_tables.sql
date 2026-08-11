-- The Practice page's 3D "Graph" view was removed in favor of the 2D
-- "Board" view (board_card/board_connection/board_node_position, see
-- V8__add_board_tables.sql) - drop its now-unused tables.
DROP TABLE IF EXISTS graph_node_position;
DROP TABLE IF EXISTS graph_connection;
DROP TABLE IF EXISTS graph_card;
