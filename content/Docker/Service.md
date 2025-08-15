# Service

1.  NetworkManager 
    

```shell
# /usr/lib/systemd/system/NetworkManager.service
[Unit]
Description=Network Manager
Documentation=man:NetworkManager(8)
Wants=network.target dbus.socket
After=network-pre.target dbus.service dbus.socket
Before=network.target network.service
PartOf=dbus.service

[Service]
Type=dbus
BusName=org.freedesktop.NetworkManager
ExecReload=/usr/bin/busctl call org.freedesktop.NetworkManager /org/freedesktop/NetworkManager org.freedesktop.NetworkManager Reload u 0
#ExecReload=/bin/kill -HUP $MAINPID
ExecStart=/usr/sbin/NetworkManager --no-daemon
Restart=on-failure
RestartSec=10s

# NM doesn't want systemd to kill its children for it
KillMode=process

# CAP_DAC_OVERRIDE: required to open /run/openvswitch/db.sock socket.
CapabilityBoundingSet=CAP_NET_ADMIN CAP_DAC_OVERRIDE CAP_NET_RAW CAP_NET_BIND_SERVICE CAP_SETGID CAP_SETUID CAP_SYS_MODULE CAP_AUDIT_WRITE CAP_KILL CAP_SYS_CHROOT

ProtectSystem=true
ProtectHome=read-only

# We require file descriptors for DHCP etc. When activating many interfaces,
# the default limit of 1024 is easily reached.
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
Also=NetworkManager-dispatcher.service

# We want to enable NetworkManager-wait-online.service whenever this service
# is enabled. NetworkManager-wait-online.service has
# WantedBy=network-online.target, so enabling it only has an effect if
# network-online.target itself is enabled or pulled in by some other unit.
Also=NetworkManager-wait-online.service
```

1.  firewalld
    

```shell
# /usr/lib/systemd/system/firewalld.service
[Unit]
Description=firewalld - dynamic firewall daemon
Before=network-pre.target
Wants=network-pre.target
After=dbus.service
After=polkit.service
Conflicts=iptables.service ip6tables.service ebtables.service ipset.service nftables.service
Documentation=man:firewalld(1)

[Service]
EnvironmentFile=-/etc/sysconfig/firewalld
ExecStart=/usr/sbin/firewalld --nofork --nopid $FIREWALLD_ARGS
ExecReload=/bin/kill -HUP $MAINPID
# supress to log debug and error output also to /var/log/messages
StandardOutput=null
StandardError=null
Type=dbus
BusName=org.fedoraproject.FirewallD1
KillMode=mixed
Restart=on-failure

[Install]
WantedBy=multi-user.target
Alias=dbus-org.fedoraproject.FirewallD1.service
```

3.  mariadb
    

```shell
# /usr/lib/systemd/system/mariadb.service
# It's not recommended to modify this file in-place, because it will be
# overwritten during package upgrades.  If you want to customize, the
# best way is to:
#
# root> systemctl edit mariadb.service
#
# Then add additonal directives under a section (probably [Service]).
#
# For more info about custom unit files, see systemd.unit(5) or
# http://fedoraproject.org/wiki/Systemd#How_do_I_customize_a_unit_file.2F_add_a_custom_unit_file.3F
#
# For example, if you want to increase MariaDB's open-files-limit to 10000,
# you need to increase systemd's LimitNOFILE setting, use the contents below:
#
#       [Service]
#       LimitNOFILE=10000
#

[Unit]
Description=MariaDB 10.5.15 database server
Documentation=man:mariadbd(8)
Documentation=https://mariadb.com/kb/en/library/systemd/
After=network.target

[Install]
WantedBy=multi-user.target
Alias=mysql.service
Alias=mysqld.service

[Service]
Type=notify
User=mysql
Group=mysql

ExecStartPre=/usr/libexec/mariadb-check-socket
# '%n' expands to 'Full unit name'; man systemd.unit
ExecStartPre=/usr/libexec/mariadb-prepare-db-dir %n
# MYSQLD_OPTS here is for users to set in /etc/systemd/system/mysql@.service.d/MY_SPECIAL.conf
# Note: we set --basedir to prevent probes that might trigger SELinux alarms,
# per bug #547485
ExecStart=/usr/libexec/mariadbd --basedir=/var/lib/mysql/ $MYSQLD_OPTS $_WSREP_NEW_CLUSTER
ExecStartPost=/usr/libexec/mariadb-check-upgrade

# Setting this to true can break replication and the Type=notify settings
# See also bind-address MariaDB option.
PrivateNetwork=false

KillSignal=SIGTERM

# Don't want to see an automated SIGKILL ever
SendSIGKILL=no

# Restart crashed server only, on-failure would also restart, for example, when
# my.cnf contains unknown option
Restart=on-abort
RestartSec=5s

UMask=007

# Give a reasonable amount of time for the server to start up/shut down
TimeoutSec=300

# Place temp files in a secure directory, not /tmp
PrivateTmp=true
```