FROM nginx:1.27-alpine

COPY ./semantic-search-app/frontend/ /usr/share/nginx/html/
COPY ./static-server/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80