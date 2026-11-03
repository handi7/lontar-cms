-- Initialize test database and permissions for user 'lontar'
CREATE DATABASE IF NOT EXISTS `lontar_test`;
GRANT ALL PRIVILEGES ON `lontar_test`.* TO 'lontar'@'%';
GRANT ALL PRIVILEGES ON `lontar_test%`.* TO 'lontar'@'%';
FLUSH PRIVILEGES;
